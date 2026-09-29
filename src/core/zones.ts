/** Wall-clock ↔ UTC conversion in an IANA time zone (historical DST rules come from Intl). */

export function localParts(d: Date, tz: string): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** UTC instant for a local date ("YYYY-MM-DD") and time ("HH:MM") in a zone. */
export function fromLocal(date: string, time: string, tz: string): Date | null {
  const [y, mo, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if (!y || !mo || !d || Number.isNaN(hh)) return null;
  const target = Date.UTC(y, mo - 1, d, hh, mm || 0);
  let guess = target;
  // Two fixed-point passes settle the zone offset (including DST changes).
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz);
    const [py, pmo, pd] = p.date.split('-').map(Number);
    const [ph, pm] = p.time.split(':').map(Number);
    guess += target - Date.UTC(py, pmo - 1, pd, ph, pm);
  }
  const out = new Date(guess);
  // Years before 100 need setUTCFullYear to avoid the 19xx mapping.
  if (y < 100) out.setUTCFullYear(y);
  return out;
}
