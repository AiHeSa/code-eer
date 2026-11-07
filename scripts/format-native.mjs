import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const check = process.argv.includes('--check');
const env = {
    ...process.env,
    ...(existsSync('.cache/toolchains/cargo')
        ? { CARGO_HOME: process.env.CARGO_HOME ?? join(root, '.cache/toolchains/cargo') }
        : {}),
    ...(existsSync('.cache/toolchains/rustup')
        ? { RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(root, '.cache/toolchains/rustup') }
        : {}),
};

function run(command, args) {
    const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

function tool(variable, local, fallback) {
    return process.env[variable] ?? (existsSync(local) ? local : fallback);
}

// Go's printer understands raw literals; replacing tabs in the file text would change literal values.
const goPrinter = `package main

import (
    "bytes"
    "flag"
    "fmt"
    "go/parser"
    "go/printer"
    "go/token"
    "os"
)

func formatFile(path string, check bool) error {
    source, err := os.ReadFile(path)
    if err != nil { return err }
    files := token.NewFileSet()
    tree, err := parser.ParseFile(files, path, source, parser.ParseComments)
    if err != nil { return err }
    var output bytes.Buffer
    config := printer.Config{Mode: printer.UseSpaces, Tabwidth: 4}
    if err := config.Fprint(&output, files, tree); err != nil { return err }
    text := append(bytes.TrimRight(output.Bytes(), "\\n"), '\\n')
    if bytes.Equal(source, text) { return nil }
    if check { return fmt.Errorf("%s needs formatting", path) }
    info, err := os.Stat(path)
    if err != nil { return err }
    return os.WriteFile(path, text, info.Mode().Perm())
}

func main() {
    check := flag.Bool("check", false, "check without writing")
    flag.Parse()
    for _, path := range flag.Args() {
        if err := formatFile(path, *check); err != nil {
            fmt.Fprintln(os.Stderr, err)
            os.Exit(1)
        }
    }
}
`;

async function formatGo(files) {
    const directory = join(root, '.cache/format-go');
    await mkdir(directory, { recursive: true });
    const source = join(directory, 'main.go');
    const binary = join(directory, 'format-go');
    await writeFile(source, goPrinter);
    run(tool('CODE_EER_GO', '.cache/toolchains/go/bin/go', 'go'), ['build', '-o', binary, source]);
    run(binary, [...(check ? ['-check'] : []), ...files]);
}

async function main() {
    if (process.argv.slice(2).some((argument) => argument !== '--check'))
        throw new Error('Usage: format-native.mjs [--check]');
    const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        encoding: 'utf8',
    });
    if (git.status !== 0) throw new Error(git.stderr || String(git.error));
    const paths = [...new Set(git.stdout.split('\0').filter(Boolean))].filter(
        (path) => !path.startsWith('tests/fixtures/'),
    );
    const python = paths.filter((path) => path.endsWith('.py'));
    const rust = paths.filter((path) => path.endsWith('.rs'));
    const go = paths.filter((path) => path.endsWith('.go'));

    if (python.length)
        run(tool('CODE_EER_RUFF', '.cache/toolchains/python/bin/ruff', 'ruff'), [
            'format',
            ...(check ? ['--check'] : []),
            ...python,
        ]);
    if (rust.length)
        run(tool('CODE_EER_RUSTFMT', '.cache/toolchains/cargo/bin/rustfmt', 'rustfmt'), [
            ...(check ? ['--check'] : []),
            ...rust,
        ]);
    if (go.length) await formatGo(go);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
