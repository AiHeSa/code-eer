use std::fmt::Debug;

pub struct Store;

pub trait Loader {
    fn load(&self, value: &str) -> String;
}

impl Loader for Store {
    fn load(&self, value: &str) -> String { value.to_owned() }
}

pub async fn plain(value: &str) -> String { value.to_owned() }
