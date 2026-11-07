package main

type SemanticLocation struct {
    Path  string `json:"path"`
    Start int    `json:"start"`
    End   int    `json:"end"`
}

type SemanticReference struct {
    Name        string            `json:"name"`
    Path        string            `json:"path"`
    Start       int               `json:"start"`
    End         int               `json:"end"`
    Declaration bool              `json:"declaration"`
    Definition  *SemanticLocation `json:"definition"`
    TargetID    string            `json:"targetId"`
    Type        *string           `json:"type"`
}

type SemanticDiagnostic struct {
    Message  string `json:"message"`
    Severity string `json:"severity"`
}

type SemanticResult struct {
    Provider    string               `json:"provider"`
    Version     string               `json:"version"`
    Encoding    string               `json:"encoding"`
    Status      string               `json:"status"`
    References  []SemanticReference  `json:"references"`
    Diagnostics []SemanticDiagnostic `json:"diagnostics"`
    Limitations []string             `json:"limitations"`
    Imports     []SemanticImport     `json:"imports"`
}

type SemanticImport struct {
    Source   string   `json:"source"`
    Resolved bool     `json:"resolved"`
    Paths    []string `json:"paths"`
    Name     string   `json:"name"`
}
