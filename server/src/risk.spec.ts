import { incidentRisk, vulnerability } from './risk';

const now = new Date('2026-11-18T00:00:00Z');
const u = (birthDate: string, crit = false, mob: string[] = []) => ({
  birthDate,
  medicalConditions: [{ name: 'x', critical: crit }],
  mobilityNeeds: mob,
});

describe('S3 risk formulas', () => {
  it.each([
    ['adult, nothing', u('1990-01-01'), 0],
    ['age 70 exactly', u('1956-11-18'), 1],
    ['age 69', u('1956-11-19'), 0],
    ['age 5', u('2021-11-18'), 1],
    ['age 6', u('2020-11-17'), 0],
    ['critical condition', u('1990-01-01', true), 1],
    ['mobility need', u('1990-01-01', false, ['wheelchair']), 1],
    ['Ana: 76 + wheelchair', u('1950-03-14', false, ['wheelchair']), 2],
    ['all three', u('1940-01-01', true, ['other']), 3],
  ])('vulnerability: %s', (_n, user, want) => expect(vulnerability(user, now)).toBe(want));

  it.each([
    [3, 0, 2], [3, 1, 3], [3, 2, 3], [3, 3, 3],
    [2, 0, 1], [2, 1, 2], [2, 2, 3],
    [1, 0, 1], [1, 1, 1], [1, 3, 3],
  ])('incidentRisk(county %i, vuln %i) = %i', (c, v, want) => expect(incidentRisk(c, v)).toBe(want));

  it('Ana: county 3, vulnerability 2 -> risk 3', () => expect(incidentRisk(3, 2)).toBe(3));
});
