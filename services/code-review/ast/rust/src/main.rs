mod model;
mod visitor;
mod expressions;

use serde_json::{Value, json};
use std::io::{self, Read};
use syn::visit::Visit;

fn version() -> &'static str {
    include_str!("../Cargo.lock").split("[[package]]")
        .find(|block| block.contains("name = \"syn\"") && block.contains("version = \"2."))
        .and_then(|block| block.lines().find(|line| line.starts_with("version = ")))
        .and_then(|line| line.split('"').nth(1)).unwrap_or("unknown")
}

fn parse(source: &str) -> Value {
    let mut extractor = model::Extractor { source, nodes: vec![], parent: None };
    let mut diagnostics = vec![];
    match syn::parse_file(source) {
        Ok(file) => extractor.visit_file(&file),
        Err(error) => {
            let (start, end) = extractor.bounds(error.span());
            diagnostics.push(json!({"code": "SYNTAX_ERROR", "message": error.to_string(),
                "start": start, "end": end}));
        }
    }
    json!({"version": version(), "runtime": "syn",
        "encoding": "utf8", "nodes": extractor.nodes, "structureComplete": diagnostics.is_empty(),
        "diagnostics": diagnostics})
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let request: Value = serde_json::from_str(&input)?;
    let source = request["source"].as_str().ok_or("Missing source")?;
    println!("{}", parse(source));
    Ok(())
}
