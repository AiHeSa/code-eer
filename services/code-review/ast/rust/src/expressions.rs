use crate::model::Extractor;
use serde_json::json;
use syn::spanned::Spanned;

impl Extractor<'_> {
    pub fn closure(&mut self, node: &syn::ExprClosure) -> usize {
        let index = self.emit("function", "ExprClosure", None, node.span());
        let parameters: Vec<_> = node.inputs.iter().map(|arg| self.text(arg)).collect();
        let returns = match &node.output {
            syn::ReturnType::Default => vec![],
            syn::ReturnType::Type(_, value) => vec![self.text(value.as_ref())],
        };
        let (start, end) = self.bounds(node.body.span());
        self.nodes[index]["parameters"] = json!(parameters);
        self.nodes[index]["returns"] = json!(returns);
        self.nodes[index]["async"] = json!(node.asyncness.is_some());
        self.nodes[index]["bodyStart"] = json!(start);
        self.nodes[index]["bodyEnd"] = json!(end);
        index
    }
}
