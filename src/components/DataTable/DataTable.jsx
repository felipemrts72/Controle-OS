import './DataTable.css';

export function DataTable({ columns, rows, emptyText = 'Nenhum registro encontrado.' }) {
  return (
    <div className="data-table">
      <table className="data-table__table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key} className={column.className}>{column.label}</th>)}
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
              {columns.map((column) => {
                const mobileLabel = column.mobileLabel || (typeof column.label === 'string' ? column.label : column.key);
                return (
                  <td key={column.key} data-label={mobileLabel} className={column.className}>
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
