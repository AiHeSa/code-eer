use crate::model::Extractor;
use serde_json::json;
use syn::{
    spanned::Spanned,
    visit::{self, Visit},
};

impl<'ast> Visit<'ast> for Extractor<'_> {
    fn visit_item_fn(&mut self, node: &'ast syn::ItemFn) {
        let index = self.callable("function", "ItemFn", &node.sig, Some(&node.block), node.span());
        self.metadata(index, &node.attrs, Some(&node.vis), Some(&node.sig.generics));
        let parent = self.parent.replace(index.to_string());
        visit::visit_item_fn(self, node);
        self.parent = parent;
    }

    fn visit_impl_item_fn(&mut self, node: &'ast syn::ImplItemFn) {
        let index = self.callable("method", "ImplItemFn", &node.sig, Some(&node.block), node.span());
        self.metadata(index, &node.attrs, Some(&node.vis), Some(&node.sig.generics));
        let parent = self.parent.replace(index.to_string());
        visit::visit_impl_item_fn(self, node);
        self.parent = parent;
    }

    fn visit_trait_item_fn(&mut self, node: &'ast syn::TraitItemFn) {
        let index = self.callable("method", "TraitItemFn", &node.sig, node.default.as_ref(), node.span());
        self.metadata(index, &node.attrs, None, Some(&node.sig.generics));
        let parent = self.parent.replace(index.to_string());
        visit::visit_trait_item_fn(self, node);
        self.parent = parent;
    }

    fn visit_item_impl(&mut self, node: &'ast syn::ItemImpl) {
        let name = self.text(node.self_ty.as_ref());
        let index = self.emit("type", "ItemImpl", Some(name), node.span());
        self.nodes[index]["data"] = json!({"container": "impl", "declaration": self.text(node)});
        self.metadata(index, &node.attrs, None, Some(&node.generics));
        let parent = self.parent.replace(index.to_string());
        visit::visit_item_impl(self, node);
        self.parent = parent;
    }

    fn visit_item_trait(&mut self, node: &'ast syn::ItemTrait) {
        let index = self.emit("type", "ItemTrait", Some(node.ident.to_string()), node.span());
        self.metadata(index, &node.attrs, Some(&node.vis), Some(&node.generics));
        let parent = self.parent.replace(index.to_string());
        visit::visit_item_trait(self, node);
        self.parent = parent;
    }

    fn visit_item_struct(&mut self, node: &'ast syn::ItemStruct) {
        let index = self.emit("type", "ItemStruct", Some(node.ident.to_string()), node.span());
        self.metadata(index, &node.attrs, Some(&node.vis), Some(&node.generics));
        let parent = self.parent.replace(index.to_string());
        visit::visit_item_struct(self, node);
        self.parent = parent;
    }

    fn visit_item_enum(&mut self, node: &'ast syn::ItemEnum) {
        let index = self.emit("type", "ItemEnum", Some(node.ident.to_string()), node.span());
        self.metadata(index, &node.attrs, Some(&node.vis), Some(&node.generics));
        let parent = self.parent.replace(index.to_string());
        visit::visit_item_enum(self, node);
        self.parent = parent;
    }

    fn visit_item_type(&mut self, node: &'ast syn::ItemType) {
        let index = self.emit("type", "ItemType", Some(node.ident.to_string()), node.span());
        self.metadata(index, &node.attrs, Some(&node.vis), Some(&node.generics));
        let parent = self.parent.replace(index.to_string());
        visit::visit_item_type(self, node);
        self.parent = parent;
    }

    fn visit_trait_item_type(&mut self, node: &'ast syn::TraitItemType) {
        let index = self.emit("type", "TraitItemType", Some(node.ident.to_string()), node.span());
        self.metadata(index, &node.attrs, None, Some(&node.generics));
        let parent = self.parent.replace(index.to_string());
        visit::visit_trait_item_type(self, node);
        self.parent = parent;
    }

    fn visit_impl_item_type(&mut self, node: &'ast syn::ImplItemType) {
        let index = self.emit("type", "ImplItemType", Some(node.ident.to_string()), node.span());
        self.metadata(index, &node.attrs, Some(&node.vis), Some(&node.generics));
        let parent = self.parent.replace(index.to_string());
        visit::visit_impl_item_type(self, node);
        self.parent = parent;
    }

    fn visit_item_use(&mut self, node: &'ast syn::ItemUse) {
        let index = self.emit("import", "ItemUse", Some(self.text(&node.tree)), node.span());
        self.metadata(index, &node.attrs, Some(&node.vis), None);
    }

    fn visit_item_extern_crate(&mut self, node: &'ast syn::ItemExternCrate) {
        let index = self.emit("import", "ItemExternCrate", Some(node.ident.to_string()), node.span());
        self.nodes[index]["data"] = json!({"alias": node.rename.as_ref().map(|(_, name)| name.to_string())});
        self.metadata(index, &node.attrs, Some(&node.vis), None);
    }

    fn visit_item_mod(&mut self, node: &'ast syn::ItemMod) {
        let index = self.emit("module", "ItemMod", Some(node.ident.to_string()), node.span());
        self.metadata(index, &node.attrs, Some(&node.vis), None);
        let parent = self.parent.replace(index.to_string());
        visit::visit_item_mod(self, node);
        self.parent = parent;
    }

    fn visit_item_union(&mut self, node: &'ast syn::ItemUnion) {
        let index = self.emit("type", "ItemUnion", Some(node.ident.to_string()), node.span());
        self.metadata(index, &node.attrs, Some(&node.vis), Some(&node.generics));
        let parent = self.parent.replace(index.to_string());
        visit::visit_item_union(self, node);
        self.parent = parent;
    }

    fn visit_expr_closure(&mut self, node: &'ast syn::ExprClosure) {
        let index = self.closure(node);
        let parent = self.parent.replace(index.to_string());
        visit::visit_expr_closure(self, node);
        self.parent = parent;
    }

    fn visit_item_foreign_mod(&mut self, node: &'ast syn::ItemForeignMod) {
        let name = node.abi.name.as_ref().map(|name| name.value());
        let index = self.emit("module", "ItemForeignMod", name, node.span());
        let parent = self.parent.replace(index.to_string());
        visit::visit_item_foreign_mod(self, node);
        self.parent = parent;
    }

    fn visit_foreign_item_fn(&mut self, node: &'ast syn::ForeignItemFn) {
        self.callable("function", "ForeignItemFn", &node.sig, None, node.span());
    }
}
