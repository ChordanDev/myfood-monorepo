import React from 'react';
import { act, create } from 'react-test-renderer';
import { fixtureFavorites } from '../../fixtures/favorites';
import { useFavoritesStore } from '../../store';
import { useClearFavoritesOnSignOut } from '../useClearFavoritesOnSignOut';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

let mockUser: { id: string } | null = null;

jest.mock('@/features/auth', () => ({
  useAuth: () => ({ user: mockUser }),
}));

function Probe() {
  useClearFavoritesOnSignOut();
  return null;
}

function mount() {
  let tree: ReturnType<typeof create>;
  act(() => {
    tree = create(<Probe />);
  });

  return {
    rerender: () => act(() => tree.update(<Probe />)),
    unmount: () => act(() => tree.unmount()),
  };
}

beforeEach(() => {
  mockUser = null;
  useFavoritesStore.setState({ favorites: fixtureFavorites(), ownerUserId: 'user-1' });
});

describe('useClearFavoritesOnSignOut', () => {
  it('keeps the favorites when the same user signs in after a cold start', () => {
    const view = mount();
    mockUser = { id: 'user-1' };
    view.rerender();

    expect(useFavoritesStore.getState().favorites).toHaveLength(2);
    expect(useFavoritesStore.getState().ownerUserId).toBe('user-1');
    view.unmount();
  });

  it('empties the cached favorites of another user who signs in after a cold start', () => {
    const view = mount();
    mockUser = { id: 'user-2' };
    view.rerender();

    expect(useFavoritesStore.getState().favorites).toEqual([]);
    expect(useFavoritesStore.getState().ownerUserId).toBe('user-2');
    view.unmount();
  });

  it('empties the favorites when the signed-in user goes away', () => {
    mockUser = { id: 'user-1' };
    const view = mount();

    mockUser = null;
    view.rerender();

    expect(useFavoritesStore.getState().favorites).toEqual([]);
    view.unmount();
  });

  it('empties the favorites when another user signs in', () => {
    mockUser = { id: 'user-1' };
    const view = mount();

    mockUser = { id: 'user-2' };
    view.rerender();

    expect(useFavoritesStore.getState().favorites).toEqual([]);
    view.unmount();
  });
});
