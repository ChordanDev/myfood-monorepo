import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { isApiError } from '@/api/errors';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { formatQuantityMilli } from '../domain';
import type { VoiceApplyPayload, VoiceApplyResult, VoiceIntent, VoicePreview } from '../types';
import {
  InventorySheet,
  InventorySheetField,
  InventorySheetForm,
  useInventorySheetWrite,
} from './InventorySheet';

interface InventoryVoiceSheetProps {
  visible: boolean;
  onPreview: (transcript: string) => Promise<VoicePreview>;
  onApply: (payload: VoiceApplyPayload) => Promise<VoiceApplyResult>;
  onClose: () => void;
}

// Voice adjustment of the inventory. The transcript is typed in the sheet for now: no speech
// recognition is wired, and a speech source plugs into the same `transcript` input later.
//
// The sheet never applies an intent the API flags as low confidence (`confirmationRequired`)
// until the User taps Confirm, and only then sends `confirmed: true`. The same goes for an
// intent the API refuses to apply unconfirmed after all: it is previewed again and confirmed.
export function InventoryVoiceSheet({
  visible,
  onPreview,
  onApply,
  onClose,
}: InventoryVoiceSheetProps) {
  const { opening, pending, errorMessage, run, close } = useInventorySheetWrite(visible, onClose);

  return (
    <InventorySheet visible={visible} onClose={close}>
      <InventoryVoiceForm
        key={opening}
        pending={pending}
        errorMessage={errorMessage}
        onPreview={onPreview}
        onApply={onApply}
        run={run}
        onClose={close}
      />
    </InventorySheet>
  );
}

// An amount of an ingredient, as a step words it.
type VoiceAmount = Pick<VoiceIntent, 'name' | 'unit' | 'quantityMilli'>;

type Step =
  | { name: 'entry' }
  | { name: 'confirm'; transcript: string; intent: VoiceIntent }
  // What the API subtracted, which is less than the intent asked for when the stock ran short.
  | { name: 'done'; subtracted: VoiceAmount };

interface InventoryVoiceFormProps {
  pending: 'submit' | 'secondary' | null;
  errorMessage: string | null;
  onPreview: (transcript: string) => Promise<VoicePreview>;
  onApply: (payload: VoiceApplyPayload) => Promise<VoiceApplyResult>;
  run: ReturnType<typeof useInventorySheetWrite>['run'];
  onClose: () => void;
}

function describeAmount({ quantityMilli, unit, name }: VoiceAmount): string {
  return `${formatQuantityMilli(quantityMilli, unit)} de ${name}`;
}

function isConfirmationRequired(error: unknown): boolean {
  return isApiError(error) && error.code === 'voice_confirmation_required';
}

function InventoryVoiceForm({
  pending,
  errorMessage,
  onPreview,
  onApply,
  run,
  onClose,
}: InventoryVoiceFormProps) {
  const { theme } = useRecipeTheme();
  const [transcript, setTranscript] = useState('');
  const [step, setStep] = useState<Step>({ name: 'entry' });
  const trimmed = transcript.trim();

  // Every step stays open on success: the next step, or the result, is drawn in the sheet.
  const stayOpen = () => false;

  const apply = async (payload: VoiceApplyPayload) => {
    const { quantityDeltaMilli } = await onApply(payload);
    const { name, unit } = payload.intent;

    setStep({ name: 'done', subtracted: { name, unit, quantityMilli: -quantityDeltaMilli } });
  };

  const handlePreview = () => {
    if (!trimmed) return;

    run(
      'submit',
      async () => {
        const preview = await onPreview(trimmed);

        if (preview.confirmationRequired) {
          setStep({ name: 'confirm', transcript: trimmed, intent: preview.intent });
          return;
        }

        try {
          await apply({ transcript: trimmed, intent: preview.intent, confirmed: false });
        } catch (error) {
          if (!isConfirmationRequired(error)) throw error;

          // The stock changed since the preview, so its intent is stale. The User confirms a
          // fresh one, whatever its confidence: nothing is applied unconfirmed a second time.
          const fresh = await onPreview(trimmed);
          setStep({ name: 'confirm', transcript: trimmed, intent: fresh.intent });
        }
      },
      stayOpen
    );
  };

  const handleConfirm = ({ transcript, intent }: Extract<Step, { name: 'confirm' }>) => {
    run('submit', () => apply({ transcript, intent, confirmed: true }), stayOpen);
  };

  if (step.name === 'done') {
    return (
      <InventorySheetForm
        title="Listo"
        pending={pending}
        errorMessage={errorMessage}
        canSubmit
        submit={{ label: 'Cerrar', pendingLabel: 'Cerrar', onPress: onClose }}
        onClose={onClose}>
        <Text style={[styles.message, { color: theme.textLight }]}>
          {`Descontamos ${describeAmount(step.subtracted)} de tu inventario.`}
        </Text>
      </InventorySheetForm>
    );
  }

  if (step.name === 'confirm') {
    return (
      <InventorySheetForm
        title="¿Es esto lo que usaste?"
        pending={pending}
        errorMessage={errorMessage}
        canSubmit
        submit={{
          label: 'Confirmar',
          pendingLabel: 'Aplicando…',
          onPress: () => handleConfirm(step),
        }}
        onClose={onClose}>
        <Text style={[styles.message, { color: theme.textLight }]}>
          {`Entendimos: descontar ${describeAmount(step.intent)}.`}
        </Text>
      </InventorySheetForm>
    );
  }

  return (
    <InventorySheetForm
      title="Ajustar por voz"
      subtitle="Contanos qué usaste, por ejemplo: usé 500 gramos de arroz."
      pending={pending}
      errorMessage={errorMessage}
      canSubmit={trimmed.length > 0}
      submit={{ label: 'Interpretar', pendingLabel: 'Interpretando…', onPress: handlePreview }}
      onClose={onClose}>
      {/* A speech source fills this same value later. */}
      <InventorySheetField
        label="Qué usaste"
        value={transcript}
        onChangeText={setTranscript}
        autoCapitalize="none"
        multiline
      />
    </InventorySheetForm>
  );
}

const styles = StyleSheet.create({
  message: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
