use super::span::{BLOCK, Span};

pub(super) const DONE: u32 = u32::MAX;

pub(super) struct Cursor<'a> {
    span: &'a Span,
    block: usize,
    at: usize,
    count: usize,
    loaded: bool,
    counted: bool,
    normed: bool,
    docs: [u32; BLOCK],
    tfs: [u32; BLOCK],
    norms: [u8; BLOCK],
    pub doc: u32,
}

impl<'a> Cursor<'a> {
    pub(super) fn new(span: &'a Span) -> Self {
        Self {
            span,
            block: 0,
            at: 0,
            count: 0,
            loaded: false,
            counted: false,
            normed: false,
            docs: [0; BLOCK],
            tfs: [0; BLOCK],
            norms: [0; BLOCK],
            doc: 0,
        }
    }

    pub(super) fn block(&self) -> usize {
        self.block
    }

    pub(super) fn last(&self) -> u32 {
        (self.span.metas.get(self.block)).map_or(DONE, |meta| meta.last)
    }

    pub(super) fn shallow(&mut self, target: u32) -> bool {
        let metas = &self.span.metas;
        if metas.get(self.block).is_some_and(|meta| meta.last < target) {
            let rest = &metas[self.block + 1..];
            self.block += 1 + rest.partition_point(|meta| meta.last < target);
            self.loaded = false;
        }
        if self.block >= metas.len() {
            self.doc = DONE;
            return false;
        }
        true
    }

    pub(super) fn seek(&mut self, target: u32) {
        if self.doc >= target && self.loaded {
            return;
        }
        while self.shallow(target) {
            self.load();
            while self.at < self.count && self.docs[self.at] < target {
                self.at += 1;
            }
            if self.at < self.count {
                self.doc = self.docs[self.at];
                return;
            }
            self.skip();
        }
    }

    pub(super) fn next(&mut self) {
        self.at += 1;
        if self.at < self.count {
            self.doc = self.docs[self.at];
            return;
        }
        self.skip();
        if self.block < self.span.metas.len() {
            self.load();
            self.doc = self.docs[0];
        }
    }

    fn skip(&mut self) {
        self.block += 1;
        self.loaded = false;
        if self.block >= self.span.metas.len() {
            self.doc = DONE;
        }
    }

    fn load(&mut self) {
        if !self.loaded {
            self.count = self.span.docs(self.block, &mut self.docs);
            self.at = 0;
            self.loaded = true;
            self.counted = false;
            self.normed = false;
        }
    }

    pub(super) fn tf(&mut self) -> u32 {
        if !self.counted {
            self.span.tfs(self.block, &mut self.tfs);
            self.counted = true;
        }
        self.tfs[self.at]
    }

    pub(super) fn norm(&mut self) -> u8 {
        if !self.normed {
            self.span.norms(self.block, &mut self.norms);
            self.normed = true;
        }
        self.norms[self.at]
    }
}
