// The server generates ranked passages from its own copy of the word list; it must stay identical to the client's.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getWordList } from '../src/data/wordlists';

describe('server word list', () => {
  it('matches the client English normal list exactly', () => {
    const sql = readFileSync('supabase/migrations/20261123000000_security_hardening.sql', 'utf8');
    const m = sql.match(/insert into public\.ft_words \(word\) select unnest\(string_to_array\(\s*'([^']+)'/);
    expect(m).not.toBeNull();
    expect(m![1]!.split(' ')).toEqual(getWordList('english', 'normal'));
  });
});
