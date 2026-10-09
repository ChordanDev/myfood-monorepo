import React from 'react';
import { create } from 'react-test-renderer';
import LeftoversRoute from '../leftovers';

jest.mock('../../src/features/leftovers', () => ({
  LeftoversScreen: () => 'LeftoversScreen',
}));

describe('leftovers route', () => {
  it('renders the screen of the leftovers feature', () => {
    let tree: ReturnType<typeof create> | undefined;
    React.act(() => {
      tree = create(<LeftoversRoute />);
    });

    expect(tree!.toJSON()).toBe('LeftoversScreen');
  });
});
