export interface Column<Row> {
  head: string;
  of(row: Row): string;
}

export function renderTable<Row>(columns: readonly Column<Row>[], rows: readonly Row[]): string {
  const widths = columns.map((column) =>
    Math.max(column.head.length, ...rows.map((row) => column.of(row).length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd();
  return [
    line(columns.map((column) => column.head)),
    ...rows.map((row) => line(columns.map((column) => column.of(row)))),
  ].join('\n');
}
