export type Event = { date?: string; place?: string };
export type Person = {
  id: string; name: string; surname: string; birth: Event; death: Event;
  notes: string[]; sources: string[]; parents: string[]; partners: string[]; children: string[];
};
export type Tree = { people: Person[]; warnings: string[] };

type Line = { level: number; id?: string; tag: string; value: string; number: number };
const pointer = /^@[^@\s]+@$/;

export function parseGedcom(text: string): Tree {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes("\ufffd") || text.includes("\0")) throw new Error("Unreadable bytes: use a UTF-8 GEDCOM file.");
  const lines: Line[] = text.replace(/\r\n?/g, "\n").split("\n").flatMap((raw, index) => {
    if (!raw.trim()) return [];
    const match = /^(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?:\s+(.*))?$/.exec(raw);
    if (!match) throw new Error(`Malformed GEDCOM line ${index + 1}.`);
    return [{ level: Number(match[1]), id: match[2], tag: match[3], value: match[4] ?? "", number: index + 1 }];
  });
  if (lines[0]?.tag !== "HEAD" || lines[0].level !== 0) throw new Error("Missing GEDCOM HEAD record.");
  let version = "", charset = "";
  const records: { head: Line; body: Line[] }[] = [];
  const seen = new Set<string>();
  let previousLevel = 0;
  for (const line of lines) {
    if (line.level > previousLevel + 1 || (line.level > 0 && line.id)) throw new Error(`Malformed GEDCOM level at line ${line.number}.`);
    previousLevel = line.level;
    if (line.level === 0) {
      if (line.id) {
        if (seen.has(line.id)) throw new Error(`Duplicate record ID ${line.id} at line ${line.number}.`);
        seen.add(line.id);
      }
      records.push({ head: line, body: [] });
    } else {
      if (!records.length) throw new Error(`Record missing at line ${line.number}.`);
      records[records.length - 1].body.push(line);
    }
  }
  const head = records[0].body;
  for (let i = 0; i < head.length; i++) {
    if (head[i].tag === "GEDC" && head[i].level === 1) version = head[i + 1]?.tag === "VERS" ? head[i + 1].value : "";
    if (head[i].tag === "CHAR" && head[i].level === 1) charset = head[i].value;
  }
  if (version !== "5.5.1") throw new Error(`Unsupported GEDCOM version ${version || "(missing)"}; use 5.5.1.`);
  if (charset.toUpperCase() !== "UTF-8") throw new Error(`Unsupported character set ${charset || "(missing)"}; use UTF-8.`);
  const individuals = records.filter((record) => record.head.tag === "INDI");
  if (individuals.length > 2000) throw new Error("Too many people: limit is 2,000 individuals.");
  if (!individuals.length) throw new Error("No usable person records found.");
  const missingId = individuals.find((record) => !record.head.id);
  if (missingId) throw new Error(`INDI at line ${missingId.head.number}: missing ID.`);
  const warnings: string[] = [];
  const sourceTitles = new Map(records.filter((record) => record.head.tag === "SOUR" && record.head.id).map((record) => [record.head.id!, record.body.find((line) => line.level === 1 && line.tag === "TITL")?.value ?? record.head.id!]));
  const noteRecords = new Map(records.filter((record) => record.head.tag === "NOTE" && record.head.id).map((record) => [record.head.id!, record]));
  const continued = (value: string, body: Line[], level: number) => {
    let result = value;
    for (const line of body) {
      if (line.level === level && line.tag === "CONT") result += "\n" + line.value;
      if (line.level === level && line.tag === "CONC") result += line.value;
    }
    return result;
  };
  const people = individuals.map(({ head, body }) => {
    const nameIndex = body.findIndex((line) => line.level === 1 && line.tag === "NAME");
    const nameLine = nameIndex < 0 ? "" : body[nameIndex].value;
    const nameFields = nameIndex < 0 ? [] : body.slice(nameIndex + 1).filter((line) => line.level === 2).slice(0, (() => {
      const next = body.findIndex((line, i) => i > nameIndex && line.level <= 1);
      return next < 0 ? body.length : next - nameIndex - 1;
    })());
    const field = (tag: string) => nameFields.find((line) => line.tag === tag)?.value ?? "";
    const surname = /\/([^/]*)\//.exec(nameLine)?.[1] || field("SURN");
    const name = nameLine.replaceAll("/", "").trim() || [field("GIVN"), surname].filter(Boolean).join(" ") || `Unnamed person (${head.id})`;
    const event = (tag: string): Event => {
      const start = body.findIndex((line) => line.level === 1 && line.tag === tag);
      if (start < 0) return {};
      const fields = [] as Line[];
      for (let i = start + 1; i < body.length && body[i].level > 1; i++) fields.push(body[i]);
      return { date: fields.find((line) => line.tag === "DATE")?.value, place: fields.find((line) => line.tag === "PLAC")?.value };
    };
    const notes: string[] = [];
    const sources: string[] = [];
    for (let i = 0; i < body.length; i++) {
      const line = body[i];
      if (line.level !== 1 || !["NOTE", "SOUR"].includes(line.tag)) continue;
      const end = body.findIndex((item, j) => j > i && item.level <= 1);
      const continuation = body.slice(i + 1, end < 0 ? undefined : end);
      if (line.tag === "NOTE" && pointer.test(line.value)) {
        const note = noteRecords.get(line.value);
        if (note) notes.push(continued(note.head.value, note.body, 1));
        else warnings.push(`${head.id} references missing note ${line.value}.`);
      } else (line.tag === "NOTE" ? notes : sources).push(line.tag === "SOUR" && pointer.test(line.value) ? sourceTitles.get(line.value) ?? line.value : continued(line.value, continuation, 2));
    }
    return { id: head.id!, name, surname, birth: event("BIRT"), death: event("DEAT"), notes, sources, parents: [], partners: [], children: [] };
  });
  if (!people.length) throw new Error("No usable person records found.");
  const byId = new Map(people.map((person) => [person.id, person]));
  const add = (person: Person, key: "parents" | "partners" | "children", id: string) => {
    if (!person[key].includes(id)) person[key].push(id);
  };
  for (const { head: family, body } of records.filter((record) => record.head.tag === "FAM")) {
    const ids = (tag: string) => body.filter((line) => line.level === 1 && line.tag === tag).map((line) => line.value);
    const parents = [...ids("HUSB"), ...ids("WIFE")];
    const children = ids("CHIL");
    for (const id of [...parents, ...children]) {
      if (!byId.has(id)) warnings.push(`Family ${family.id ?? `line ${family.number}`} links to missing person ${id}.`);
    }
    for (const id of parents) for (const other of parents) {
      if (id !== other && byId.has(id) && byId.has(other)) add(byId.get(id)!, "partners", other);
    }
    for (const child of children) for (const parent of parents) {
      if (byId.has(child) && byId.has(parent)) {
        add(byId.get(child)!, "parents", parent);
        add(byId.get(parent)!, "children", child);
      }
    }
  }
  for (const { head, body } of individuals) {
    for (const line of body.filter((item) => item.level === 1 && ["FAMC", "FAMS"].includes(item.tag))) {
      if (pointer.test(line.value) && !seen.has(line.value)) warnings.push(`${head.id} references missing family ${line.value}.`);
    }
  }
  return { people, warnings: [...new Set(warnings)] };
}
