import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { formatQuantityMilli } from '../domain';
import type { VoiceApplyPayload, VoiceIntent, VoicePreview } from '../types';
import {
  InventorySheet,
  InventorySheetField,
  InventorySheetForm,
  useInventorySheetWrite,
} from './InventorySheet';

interface InventoryVoiceSheetProps {
  visible: boolean;
  onPreview: (transcript: string) => Promise<VoicePreview>;
  onApply: (payload: VoiceApplyPayload) => Promise<unknown>;
  onClose: () => void;
}

// Voice adjustment of the inventory. The transcript is typed in the sheet for now: no speech
// recognition is wired, and a speech source plugs into the same `transcript` input later.
//
// The sheet never applies an intent the API flags as low confidence (`confirmationRequired`)
// until the User taps Confirm, and only then sends `confirmed: true`.
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

type Step =
  | { name: 'entry' }
  | { name: 'confirm'; transcript: string; intent: VoiceIntent }
  | { name: 'done'; intent: VoiceIntent };

interface InventoryVoiceFormProps {
  pending: 'submit' | 'secondary' | null;
  errorMessage: string | null;
  onPreview: (transcript: string) => Promise<VoicePreview>;
  onApply: (payload: VoiceApplyPayload) => Promise<unknown>;
  run: ReturnType<typeof useInventorySheetWrite>['run'];
  onClose: () => void;
}

function describeIntent(intent: VoiceIntent): string {
  return `${formatQuantityMilli(intent.quantityMilli, intent.unit)} de ${intent.name}`;
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

        await onApply({ transcript: trimmed, intent: preview.intent, confirmed: false });
        setStep({ name: 'done', intent: preview.intent });
      },
      stayOpen
    );
  };

  const handleConfirm = (confirming: Extract<Step, { name: 'confirm' }>) => {
    run(
      'submit',
      async () => {
        await onApply({
          transcript: confirming.transcript,
          intent: confirming.intent,
          confirmed: true,
        });
        setStep({ name: 'done', intent: confirming.intent });
      },
      stayOpen
    );
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
          {`Descontamos ${describeIntent(step.intent)} de tu inventario.`}
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
          {`Entendimos: descontar ${describeIntent(step.intent)}.`}
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
