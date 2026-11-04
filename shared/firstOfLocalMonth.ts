export function firstOfLocalMonth(from: Date): string {
  const year = from.getFullYear();
  const month = String(from.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}
