import type { InventoryItem } from '../types';

export const MOCK_INVENTORY: InventoryItem[] = [
  {
    id: 'inv-i1',
    ingredientId: 'i1',
    name: 'Arroz Blanco',
    category: 'almacen',
    quantity: 500, // Medio kilo de arroz
    unit: 'g',
    confidence: 'estimated',
  },
  {
    id: 'inv-i5',
    ingredientId: 'i5',
    name: 'Aceite de Oliva',
    category: 'almacen',
    quantity: 250, // 250ml de aceite
    unit: 'ml',
    confidence: 'estimated',
  },
  {
    id: 'inv-i4',
    ingredientId: 'i4',
    name: 'Cebolla',
    category: 'verduras',
    quantity: 3, // 3 cebollas
    unit: 'unit',
    confidence: 'exact',
  },
  {
    id: 'inv-i2',
    ingredientId: 'i2',
    name: 'Pollo (Pechuga)',
    category: 'carnes',
    quantity: 300,
    unit: 'g',
    confidence: 'exact',
  },
  // Self-contained items, not linked to the ingredient catalog
  {
    id: 'inv-milk',
    name: 'Leche',
    category: 'lacteos',
    quantity: 1000,
    unit: 'ml',
    confidence: 'estimated',
    notes: 'Abierta, usar pronto',
  },
  {
    id: 'inv-frozen-peas',
    name: 'Arvejas congeladas',
    category: 'congelados',
    quantity: 400,
    unit: 'g',
    confidence: 'estimated',
  },
  {
    id: 'inv-bananas',
    name: 'Banana',
    category: 'frutas',
    quantity: 4,
    unit: 'unit',
    confidence: 'exact',
  },
];
