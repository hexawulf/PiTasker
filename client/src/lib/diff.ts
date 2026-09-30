// Line diff for the "review crontab change" dialog: LCS over lines (crontabs
// are small), grouped into hunks with 2 lines of context.
export type DiffLine = { kind: "same" | "add" | "del"; text: string; oldNo?: number; newNo?: number };

function lines(text: string): string[] {
  if (text === "") return [];
  const l = text.split("\n");
  if (l[l.length - 1] === "") l.pop();
  return l;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = lines(before);
  const b = lines(after);
  const n = a.length;
  const m = b.length;
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i], oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      out.push({ kind: "del", text: a[i], oldNo: i + 1 }); // removals before additions
      i++;
    } else {
      out.push({ kind: "add", text: b[j], newNo: j + 1 });
      j++;
    }
  }
  return out;
}

/** Changed lines plus `context` unchanged lines around them; gaps become null. */
export function hunks(diff: DiffLine[], context = 2): (DiffLine | null)[] {
  const keep = new Array(diff.length).fill(false);
  diff.forEach((d, k) => {
    if (d.kind === "same") return;
    for (let x = Math.max(0, k - context); x <= Math.min(diff.length - 1, k + context); x++) keep[x] = true;
  });
  const out: (DiffLine | null)[] = [];
  let gap = false;
  diff.forEach((d, k) => {
    if (keep[k]) {
      out.push(d);
      gap = false;
    } else if (!gap) {
      out.push(null);
      gap = true;
    }
  });
  return out;
}
