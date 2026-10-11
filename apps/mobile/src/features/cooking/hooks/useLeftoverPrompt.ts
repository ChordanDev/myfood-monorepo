import { useRef, useState } from 'react';
import { getAuthErrorMessage } from '@/api/errors';
import {
  leftoverLineKey,
  openLeftoverForm,
  readLeftoverIngredients,
  readPreparedLeftover,
  type CookingSummary,
  type LeftoverIngredientInput,
  type LeftoverLine,
  type LeftoverStep,
  type PreparedLeftoverInput,
} from '../domain';

/** What the leftover prompt shows and takes, as its panel reads it. */
export type LeftoverPromptFlow = ReturnType<typeof useLeftoverPrompt>;

export interface LeftoverPromptOptions {
  /** The finish the prompt asks about; null while it is closed. */
  summary: CookingSummary | null;
  /** Puts what is left of one Ingredient back in Inventory. */
  onAddIngredient: (input: LeftoverIngredientInput) => Promise<unknown>;
  onCreatePrepared: (input: PreparedLeftoverInput) => Promise<unknown>;
  onClose: () => void;
}

/**
 * The leftover prompt of one finish: nothing was left, Ingredients go back to Inventory, or
 * cooked portions are kept as a Prepared leftover. The writes are online only: the prompt
 * waits for the answer, closes on success and stays open with the message of the error
 * otherwise. It keeps nothing of its own: what was saved is the server's.
 */
export function useLeftoverPrompt({
  summary,
  onAddIngredient,
  onCreatePrepared,
  onClose,
}: LeftoverPromptOptions) {
  const [openedFor, setOpenedFor] = useState(summary);
  const [form, setForm] = useState(() => openLeftoverForm(summary));
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // A ref, not state: two presses can land before the first one has re-rendered anything.
  const isWritingRef = useRef(false);

  // Every opening starts over. The form is kept on close so the sheet does not change while
  // it fades out; it is never read again.
  if (summary !== openedFor) {
    setOpenedFor(summary);
    if (summary) {
      setForm(openLeftoverForm(summary));
      setErrorMessage(null);
    }
  }

  // Nothing can be sent once the prompt is closed: the sheet stays mounted while it fades
  // out, so a late press could write again.
  const ingredients = summary ? readLeftoverIngredients(form.lines) : null;
  const prepared = summary ? readPreparedLeftover(form, summary.scheduledMealId) : null;

  const run = async (send: () => Promise<void>) => {
    if (isWritingRef.current) return;

    isWritingRef.current = true;
    setIsPending(true);
    setErrorMessage(null);

    try {
      await send();
      onClose();
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      isWritingRef.current = false;
      setIsPending(false);
    }
  };

  // The message of a failed write belongs to its step.
  const goTo = (step: LeftoverStep) => {
    if (isWritingRef.current) return;

    setErrorMessage(null);
    setForm((current) => ({ ...current, step }));
  };

  const saveIngredients = async () => {
    if (!ingredients) return;

    await run(async () => {
      for (const input of ingredients) {
        await onAddIngredient(input);
        // A saved line leaves at once, so a retry after a later failure cannot send it twice.
        const savedKey = leftoverLineKey(input);
        setForm((current) => ({
          ...current,
          lines: current.lines.filter((line) => leftoverLineKey(line) !== savedKey),
        }));
      }
    });
  };

  const savePrepared = async () => {
    if (!prepared) return;

    await run(async () => {
      await onCreatePrepared(prepared);
    });
  };

  return {
    step: form.step,
    lines: form.lines,
    title: form.title,
    portionsText: form.portionsText,
    /** Ingredients outside the cooking are not offered, so no line means no such choice. */
    offersIngredients: form.lines.length > 0,
    canSaveIngredients: ingredients !== null,
    canSavePrepared: prepared !== null,
    isPending,
    errorMessage,
    choose: (step: Exclude<LeftoverStep, 'choices'>) => goTo(step),
    back: () => goTo('choices'),
    setLineQuantity: (line: Pick<LeftoverLine, 'ingredientId' | 'unit'>, quantityText: string) => {
      const key = leftoverLineKey(line);
      setForm((current) => ({
        ...current,
        lines: current.lines.map((candidate) =>
          leftoverLineKey(candidate) === key ? { ...candidate, quantityText } : candidate
        ),
      }));
    },
    setTitle: (title: string) => setForm((current) => ({ ...current, title })),
    setPortionsText: (portionsText: string) => setForm((current) => ({ ...current, portionsText })),
    saveIngredients,
    savePrepared,
    // Dismissing counts as "nothing was left". A write on its way is waited for.
    close: () => {
      if (!isWritingRef.current) onClose();
    },
  };
}
