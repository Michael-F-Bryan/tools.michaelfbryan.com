import { expect, test } from "@playwright/test";
import { parseGedcom } from "../src/entries/gedcom-viewer/parser";

const header = "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n";

test("builds family links without inventing missing people", () => {
  const tree = parseGedcom(header + "0 @I1@ INDI\n1 NAME Jo /Lake/\n1 BIRT\n2 DATE ABT 1900\n0 @I2@ INDI\n1 NAME Eli /Lake/\n0 @F1@ FAM\n1 WIFE @I1@\n1 CHIL @I2@\n1 CHIL @I404@\n0 TRLR");
  expect(tree.people).toHaveLength(2);
  expect(tree.people[0].children).toEqual(["@I2@"]);
  expect(tree.people[1].parents).toEqual(["@I1@"]);
  expect(tree.people[0].birth.date).toBe("ABT 1900");
  expect(tree.warnings.join(" ")).toContain("@I404@");
});

test("resolves source titles and retains raw notes", () => {
  const tree = parseGedcom(header + "0 @I1@ INDI\n1 NAME Jo /Lake/\n1 NOTE Raw <b>text</b>\n1 SOUR @S1@\n0 @S1@ SOUR\n1 TITL Civil register\n0 TRLR");
  expect(tree.people[0].sources).toEqual(["Civil register"]);
  expect(tree.people[0].notes).toEqual(["Raw <b>text</b>"]);
});

test("uses structured name fields and resolves shared multi-line notes", () => {
  const tree = parseGedcom(header + "0 @I1@ INDI\n1 NAME\n2 GIVN Alice May\n2 SURN Jones\n1 NOTE @N1@\n0 @N1@ NOTE First line\n1 CONT Second line\n1 CONC continued\n0 TRLR");
  expect(tree.people[0].name).toBe("Alice May Jones");
  expect(tree.people[0].surname).toBe("Jones");
  expect(tree.people[0].notes).toEqual(["First line\nSecond linecontinued"]);
});

test("reports unresolved shared notes without displaying raw pointers", () => {
  const tree = parseGedcom(header + "0 @I1@ INDI\n1 NOTE @N404@\n0 TRLR");
  expect(tree.people[0].notes).toEqual([]);
  expect(tree.warnings.join(" " )).toContain("@N404@");
});

test("preserves physical line numbers across blanks and rejects ID-less individuals", () => {
  expect(() => parseGedcom(header + "\n0 @I1@ INDI\n\nbad record")).toThrow(/line 8/);
  expect(() => parseGedcom(header + "0 @I1@ INDI\n0 INDI\n0 TRLR")).toThrow(/INDI.*line 6.*missing ID/);
});

test("limits individuals at the exact ceiling including malformed records", () => {
  const records = Array.from({ length: 2000 }, (_, i) => `0 @I${i}@ INDI\n1 NAME Person ${i}`).join("\n");
  expect(parseGedcom(header + records + "\n0 TRLR").people).toHaveLength(2000);
  expect(() => parseGedcom(header + records + "\n0 INDI\n0 TRLR")).toThrow(/Too many people/);
});

test("rejects unsupported and malformed imports", () => {
  expect(() => parseGedcom(header.replace("5.5.1", "7.0") + "0 @I1@ INDI")).toThrow(/version/);
  expect(() => parseGedcom(header.replace("UTF-8", "ANSEL") + "0 @I1@ INDI")).toThrow(/character set/);
  expect(() => parseGedcom(header + "0 @I1@ INDI\n0 @I1@ INDI")).toThrow(/Duplicate/);
  expect(() => parseGedcom(header + "0 @I1@ INDI\n3 NAME Jo /Lake/")).toThrow(/level/);
  expect(() => parseGedcom(header + "bad record")).toThrow(/Malformed/);
});
