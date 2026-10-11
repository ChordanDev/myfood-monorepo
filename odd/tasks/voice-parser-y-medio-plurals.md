# Feature: Voice parser reads "y medio" and more plural forms (issue #155)

Ticket: ChordanDev/myfood-monorepo#155, a follow-up of #44 (PR #141).
Base: `main` at `fa49e88`. Branch: `fix/voice-parser-y-medio-plurals`.

## Objective

The rule-based voice parser reads "1 kilo y medio de queso" as 1.5 kg and matches plural forms such as "huevos de campo" and "limones" to their singular stock names.

## Problem

Both gaps are in `apps/api/lib/meal_planner_api/voice/inventory_intent_parser.ex`.

- `stated_amount` takes the first quantity match, so "me comí 1 kilo y medio de queso" subtracts 1 kg at confidence 0.9 instead of 1.5 kg.
- `plural/1` only appends "s" to the last word of the ingredient name, so "2 huevos de campo" (stock "Huevo de campo") and "2 limones" (stock "Limón") fail with `voice_parse_failed`.

## Scope and constraints

- In scope: the parser module and its tests.
- Out of scope: other fractions ("y cuarto"), the AI parser, the voice endpoints (#157), the mobile sheet (#156), retry safety of apply (#140).
- The parser keeps failing closed: a name that is not in stock still answers `voice_parse_failed` and writes nothing.
- A plural form must match on word boundaries, so a longer word that only contains a stock name does not match it.

## Tasks

- [x] **T1 "y medio" and plural forms.** Route: delegated direct (reading the parser prepares the write). Test-first with `mix test test/meal_planner_api/voice`. Commit: the work-unit commit that adds this document, `fix(api): read "y medio" and plural forms in the voice parser`.
  - `@quantity_regex` takes an optional "y medio|media" after the unit label and `quantity_amount` adds half of that unit.
  - `plural/1` became `forms/1`, applied to every word of the name: vowel + "s", consonant + "es", "z" to "ces", plus the bare "s". `mentioned?` compares whole words.
  - `count_amount` reads the name in the same forms and needs a word end after it. Without that, "2 huevos de campo" matched the name but subtracted all the stock at 0.5.

- [x] **T2 "un/una" reads as 1, and a "y medio" after a unit is never a fraction of the stock.** Added on 2026-10-11 after the User decided two open questions of T1 (D1, D2). Route: delegated direct, same writer as T1. Commit: the one after `9c19b1b`, `fix(api): read "un" as one and keep "y medio" after a unit off the stock fraction`.
  - `decimal_text/1` rewrites the whole words "un" and "una" to the digit 1, so every amount pattern reads them as it reads "1". Name matching works on `words/1` and is untouched.
  - `fraction_amount/2` drops a "y medio|media" that directly follows a unit label before it looks for a fraction of the stock.

## Decisions

- **D1 "un/una" is the number 1.** Before a unit label ("un kilo", "una unidad") and before the name of a stock counted in units ("un huevo"), it reads exactly as the digit 1 does, with the same confidence. Before the name of a stock in grams or millilitres ("un queso") nothing changes.
- **D2 "y medio" after a unit label is never a fraction of the stock.** When the stated unit is not the unit of the stock ("1 litro y medio de queso" against grams), the intent no longer reads "medio" as half the stock: it falls to the path that needs confirmation. A "medio" that does not follow a unit label ("medio queso") is still half the stock.

## Acceptance criteria

- "1 kilo y medio de queso" gives 1,500,000.
- "huevos de campo" and "limones" match "Huevo de campo" and "Limón".
- Parser tests cover both, and an unknown name still fails closed.

## Checks

- `mix test test/meal_planner_api/voice`
- `mix test` (full API suite)
- `mix format --check-formatted`, `mix credo`

## Progress

T1 and T2 done on 2026-10-11.

- RED observed before the change: `mix test test/meal_planner_api/voice`, 4 failed of 35 ("a quantity and a half" got 1,000,000; the longer-name plural matched "Huevo"; the "es"/"ces" plural gave `voice_parse_failed`; the count before a longer word got 2,000).
- GREEN: `mix test test/meal_planner_api/voice`, 36 passed. `mix test`, 1742 passed, 21 skipped, 0 failures. `mix format --check-formatted` and `mix credo` clean.

- T2 RED: `mix test test/meal_planner_api/voice`, 5 failed of 44 ("un kilo" gave all the stock at 0.5; "un kilo y medio" gave half the stock at 0.9; "un huevo" gave all the stock at 0.5; a half after a unit of another kind gave half the stock at 0.9). T2 GREEN: 44 passed. `mix test`, 1751 passed, 21 skipped, 0 failures. `mix format --check-formatted` and `mix credo` clean.

## Open questions

Decided and closed by T2: "un kilo y medio" is 1.5 kg, and "1 litro y medio" against a stock in grams needs confirmation.

Still open:

- A quantity with a unit wins over a fraction phrase, with a digit or with "un": "la mitad de un kilo de queso" reads 1 kg (500 g is meant) and "la mitad de un huevo" reads 1 unit. Before T2 the "un" forms read half of the stock, which was wrong too.
- A unit label with no number, "kilo y medio de queso", now takes all the stock at 0.5 and needs confirmation. It is not read as 1.5 kg.
- "2 huevos y medio" for a unit stock is not read as 2.5, and "2 huevos y medio de campo" fails closed.
- Only a singular stock name spoken in plural is covered. A stock named "Huevos" spoken as "1 huevo" still fails closed.
- No number words beyond "un/una": "uno de los huevos" and "dos kilos" are not read as numbers.
