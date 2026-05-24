import { describe, expect, it } from "vitest";
import { buildSynthesisContext, buildSynthesisPrompt, describeSynthesisFilters, isQuestion } from "./synthesis";
import type { Passage } from "./types";

function passage(overrides: Partial<Passage>): Passage {
  return {
    id: "passage:1",
    cts_urn: "urn:cts:greekLit:tlg0012.tlg002:1.1",
    passage_ref: "1.1-1.20",
    text: "The stranger was welcomed and given food.",
    author_id: "author:homer",
    author: "Homer",
    work_id: "work:odyssey",
    work: "Odyssey",
    genre: "epic",
    period: "Archaic",
    language: "eng",
    text_type: "translation",
    license_status: "cc_compatible",
    ...overrides
  };
}

describe("synthesis prompt", () => {
  it("detects questions across supported query languages", () => {
    expect(isQuestion("How is hospitality represented?")).toBe(true);
    expect(isQuestion("Como a hospitalidade aparece?")).toBe(true);
    expect(isQuestion("Donde aparece la justicia?")).toBe(true);
    expect(isQuestion("hospitality in the Odyssey")).toBe(false);
  });

  it("includes source judgment metadata in every passage context", () => {
    const context = buildSynthesisContext([
      passage({ genre: "epic", period: "Archaic", language: "eng", text_type: "translation" }),
      passage({
        id: "passage:2",
        cts_urn: "urn:cts:greekLit:tlg0003.tlg001:1.1",
        passage_ref: "1.1",
        author: "Thucydides",
        work: "History of the Peloponnesian War",
        genre: "history",
        period: "Classical",
        text: "The war began after disputes among cities."
      })
    ]);

    expect(context).toContain("Genre: epic");
    expect(context).toContain("Period: Archaic");
    expect(context).toContain("Language: eng");
    expect(context).toContain("Text type: translation");
    expect(context).toContain("Genre: history");
    expect(context).toContain("History of the Peloponnesian War");
  });

  it("instructs heterogeneous genres not to be blended as one evidence type", () => {
    const prompt = buildSynthesisPrompt(
      "Was hospitality a historical institution?",
      "question",
      buildSynthesisContext([
        passage({ genre: "epic", text: "A host welcomes a wandering hero." }),
        passage({
          id: "passage:2",
          author: "Thucydides",
          work: "History of the Peloponnesian War",
          genre: "history",
          text: "Envoys negotiated in wartime."
        })
      ])
    );

    expect(prompt).toContain("infer the likely scope and evidence type");
    expect(prompt).toContain("If the selected passages span different genres or evidence types, separate them explicitly");
    expect(prompt).toContain("Do not present literary, poetic, dramatic, mythical, or fictional passages as evidence for historical fact");
    expect(prompt).toContain("Use out-of-scope genres only as explicitly marked comparison");
  });

  it("includes user filter arguments as language and scope hints", () => {
    const filters = {
      genre: ["tragédia", "história"],
      work: "Medeia",
      language: "inglês"
    };
    const prompt = buildSynthesisPrompt("", "topic", "context", false, filters);

    expect(describeSynthesisFilters(filters)).toBe("Genre: tragédia OR história | Work: Medeia | Language: inglês");
    expect(prompt).toContain("use the user's filter arguments as language hints");
    expect(prompt).toContain("Treat user filter arguments as language and scope hints only");
    expect(prompt).toContain("User filter arguments: Genre: tragédia OR história | Work: Medeia | Language: inglês");
  });

  it("distinguishes retrieval text from the explicit answer question", () => {
    const prompt = buildSynthesisPrompt(
      "What moral obligations are shown?",
      "question",
      "context",
      false,
      undefined,
      "en",
      "hospitality in the Odyssey"
    );

    expect(prompt).toContain("Retrieval query: hospitality in the Odyssey");
    expect(prompt).toContain("Answer question: What moral obligations are shown?");
    expect(prompt).toContain("answer the explicit question below");
  });

  it("uses interface locale for proper names and ambiguous search terms", () => {
    const prompt = buildSynthesisPrompt("Samaratino", "topic", "context", false, undefined, "pt");

    expect(prompt).toContain("The current interface language is Portuguese (pt)");
    expect(prompt).toContain("If the query is a proper name, a single term, empty, terse, or otherwise ambiguous");
    expect(prompt).toContain("answer in Portuguese");
    expect(prompt).toContain("Interface language: Portuguese (pt)");
  });
});
