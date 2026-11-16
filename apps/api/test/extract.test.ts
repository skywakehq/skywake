import assert from "node:assert/strict";
import { test } from "node:test";

import { documentKind, extractor, oldOffice } from "../src/features/links/documents.ts";
import { docxOf, pdfOf, pptxOf, xlsxOf } from "./documents.ts";

const read = (path: string, bytes: Buffer) => extractor.read(documentKind(path)!, bytes);

test("documents are told apart by their extension", () => {
  assert.equal(documentKind("a/Report.PDF"), "pdf");
  assert.equal(documentKind("deck.pptx"), "pptx");
  assert.equal(documentKind("notes.md"), undefined);
  assert.equal(oldOffice("old.doc"), true);
  assert.equal(oldOffice("new.docx"), false);
});

test("a PDF gives its text, line by line", async () => {
  const found = await read("r.pdf", pdfOf(["Quarterly report", "Pancake sleeps on the rack"]));
  assert.deepEqual(found, { text: "Quarterly report\nPancake sleeps on the rack" });
});

test("Word, PowerPoint and Excel files give their text", async () => {
  assert.deepEqual(await read("a.docx", docxOf(["Terms & conditions", "Second <para>"])), {
    text: "Terms & conditions\nSecond <para>",
  });
  assert.deepEqual(await read("d.pptx", pptxOf([["Launch"], ["Pricing", "2 cents"]])), {
    text: "Slide 1\nLaunch\n\nSlide 2\nPricing\n2 cents",
  });
  assert.deepEqual(
    await read(
      "s.xlsx",
      xlsxOf([
        ["Customer", "Seats"],
        ["Acme", 250],
      ]),
    ),
    {
      text: "Sheet 1\nCustomer\tSeats\nAcme\t250",
    },
  );
});

test("a broken or empty document says why it can't be read", async () => {
  assert.deepEqual(await read("x.pdf", Buffer.from("not a pdf at all")), {
    reason: "not a readable PDF",
  });
  assert.deepEqual(await read("x.docx", Buffer.from("not a zip")), {
    reason: "not a readable .docx file",
  });
  assert.deepEqual(await read("x.pdf", pdfOf([])), {
    reason: "a PDF with no text layer; scanned pages need OCR",
  });
});
