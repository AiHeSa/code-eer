use proc_macro2::Span;
use serde_json::{Value, json};
use syn::spanned::Spanned;

pub struct Extractor<'a> {
    pub source: &'a str,
    pub nodes: Vec<Value>,
    pub parent: Option<String>,
}

impl<'a> Extractor<'a> {
    pub fn offset(&self, line: usize, column: usize) -> usize {
        // 公开位置统一为 UTF-8 字节偏移，不能把字符列直接用于字符串切片。
        let mut lines = self.source.split_inclusive('\n');
        let preceding = lines.by_ref().take(line.saturating_sub(1)).map(str::len).sum::<usize>();
        preceding
            + lines
                .next()
                .unwrap_or_default()
                .chars()
                .take(column)
                .map(char::len_utf8)
                .sum::<usize>()
    }

    pub fn bounds(&self, span: Span) -> (usize, usize) {
        let start = span.start();
        let end = span.end();
        (self.offset(start.line, start.column), self.offset(end.line, end.column))
    }

    pub fn text<T: Spanned>(&self, node: &T) -> String {
        let (start, end) = self.bounds(node.span());
        self.source.get(start..end).unwrap_or_default().to_owned()
    }

    pub fn emit(&mut self, kind: &str, native: &str, name: Option<String>, span: Span) -> usize {
        let (start, end) = self.bounds(span);
        let index = self.nodes.len();
        self.nodes.push(json!({"id": index.to_string(), "parent": self.parent,
            "type": kind, "nativeType": native, "name": name,
            "start": start, "end": end, "data": {}}));
        index
    }

    pub fn metadata(
        &mut self,
        index: usize,
        attrs: &[syn::Attribute],
        visibility: Option<&syn::Visibility>,
        generics: Option<&syn::Generics>,
    ) {
        self.nodes[index]["data"]["attributes"] = json!(attrs.iter().map(|a| self.text(a)).collect::<Vec<_>>());
        if let Some(value) = visibility {
            self.nodes[index]["data"]["visibility"] = json!(self.text(value));
        }
        if let Some(value) = generics {
            self.nodes[index]["data"]["generics"] = json!(self.text(value));
        }
    }

    pub fn callable(
        &mut self,
        kind: &str,
        native: &str,
        signature: &syn::Signature,
        body: Option<&syn::Block>,
        span: Span,
    ) -> usize {
        let index = self.emit(kind, native, Some(signature.ident.to_string()), span);
        let parameters: Vec<String> = signature.inputs.iter().map(|arg| self.text(arg)).collect();
        let returns = match &signature.output {
            syn::ReturnType::Default => vec![],
            syn::ReturnType::Type(_, value) => vec![self.text(value.as_ref())],
        };
        self.nodes[index]["parameters"] = json!(parameters);
        self.nodes[index]["returns"] = json!(returns);
        self.nodes[index]["async"] = json!(signature.asyncness.is_some());
        self.nodes[index]["data"] = json!({"generics": self.text(&signature.generics)});
        if let Some(block) = body {
            let (start, end) = self.bounds(block.span());
            self.nodes[index]["bodyStart"] = json!(start);
            self.nodes[index]["bodyEnd"] = json!(end);
        }
        index
    }
}
