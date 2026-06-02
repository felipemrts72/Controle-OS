import './DataTable.css';

export function DataTable({ columns, rows, emptyText = 'Nenhum registro encontrado.' }) {
  return (
    <div className="data-table">
      <table className="data-table__table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="data-table__empty">{emptyText}</td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.id || row.shipment_code || row.sale_number}>
              {columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
