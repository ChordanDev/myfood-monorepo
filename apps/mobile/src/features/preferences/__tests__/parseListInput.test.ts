import { parseListInput } from '../utils/parseListInput';

describe('parseListInput', () => {
  it('returns [] for an empty string', () => {
    expect(parseListInput('')).toEqual([]);
  });

  it('returns [] for only commas or whitespace', () => {
    expect(parseListInput(',')).toEqual([]);
    expect(parseListInput(',,,')).toEqual([]);
    expect(parseListInput('   ')).toEqual([]);
    expect(parseListInput(' , , ')).toEqual([]);
  });

  it('drops leading and trailing commas', () => {
    expect(parseListInput(',mushrooms')).toEqual(['mushrooms']);
    expect(parseListInput('mushrooms,')).toEqual(['mushrooms']);
    expect(parseListInput(',mushrooms,')).toEqual(['mushrooms']);
  });

  it('drops empty entries from repeated commas', () => {
    expect(parseListInput('cilantro,,mushrooms')).toEqual(['cilantro', 'mushrooms']);
    expect(parseListInput('cilantro,,,mushrooms')).toEqual(['cilantro', 'mushrooms']);
  });

  it('trims surrounding whitespace from each value', () => {
    expect(parseListInput('  cilantro ,  mushrooms  ')).toEqual(['cilantro', 'mushrooms']);
  });

  it('preserves order of valid values', () => {
    expect(parseListInput('mushrooms,cilantro,onion')).toEqual(['mushrooms', 'cilantro', 'onion']);
  });

  it('preserves a single value without commas', () => {
    expect(parseListInput('mushrooms')).toEqual(['mushrooms']);
    expect(parseListInput('  mushrooms  ')).toEqual(['mushrooms']);
  });
});
