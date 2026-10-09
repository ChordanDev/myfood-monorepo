import { useState } from 'react';
import { UNIT_LABEL } from '@/utils/formatQuantity';
import { milliToInputText, parseQuantityInputMilli } from '../domain';
import type { InventoryItem } from '../types';
import {
  InventorySheet,
  InventorySheetField,
  InventorySheetForm,
  useInventorySheetWrite,
} from './InventorySheet';

interface InventoryEditSheetProps {
  visible: boolean;
  item: InventoryItem | null;
  onSetQuantity: (itemId: string, quantityMilli: number) => Promise<unknown>;
  onDispose: (itemId: string) => Promise<unknown>;
  onClose: () => void;
}

// For a lot the inventory already has: sets its quantity or disposes of it. No endpoint edits
// the name or the notes of a lot, so they are only shown.
export function InventoryEditSheet({
  visible,
  item,
  onSetQuantity,
  onDispose,
  onClose,
}: InventoryEditSheetProps) {
  const { opening, pending, errorMessage, run, close } = useInventorySheetWrite(visible, onClose);

  return (
    <InventorySheet visible={visible} onClose={close}>
      {item ? (
        <InventoryEditForm
          // Keyed by item too, so the field never carries over the text typed for another one.
          key={`${item.id}:${opening}`}
          item={item}
          pending={pending}
          errorMessage={errorMessage}
          onSetQuantity={(quantityMilli) =>
            run('submit', () => onSetQuantity(item.id, quantityMilli))
          }
          onDispose={() => run('secondary', () => onDispose(item.id))}
          onClose={close}
        />
      ) : null}
    </InventorySheet>
  );
}

interface InventoryEditFormProps {
  item: InventoryItem;
  pending: 'submit' | 'secondary' | null;
  errorMessage: string | null;
  onSetQuantity: (quantityMilli: number) => void;
  onDispose: () => void;
  onClose: () => void;
}

function InventoryEditForm({
  item,
  pending,
  errorMessage,
  onSetQuantity,
  onDispose,
  onClose,
}: InventoryEditFormProps) {
  const [quantityText, setQuantityText] = useState(milliToInputText(item.quantityMilli));

  // The user types display units; the API takes thousandths. Text that is not a quantity
  // never reaches it.
  const quantityMilli = parseQuantityInputMilli(quantityText);

  const handleSave = () => {
    if (quantityMilli === null) return;

    onSetQuantity(quantityMilli);
  };

  return (
    <InventorySheetForm
      title={item.name}
      subtitle={item.notes}
      pending={pending}
      errorMessage={errorMessage}
      canSubmit={quantityMilli !== null}
      submit={{ label: 'Guardar', pendingLabel: 'Guardando…', onPress: handleSave }}
      secondary={{
        label: 'Borrar del inventario',
        pendingLabel: 'Borrando…',
        onPress: onDispose,
      }}
      onClose={onClose}>
      <InventorySheetField
        label="Cantidad"
        value={quantityText}
        onChangeText={setQuantityText}
        keyboardType="decimal-pad"
        trailing={UNIT_LABEL[item.unit]}
      />
    </InventorySheetForm>
  );
}
