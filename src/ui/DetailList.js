import './kitTheme';

// FIX actions-row-detail-v1 - the label / value lines inside a DataTable row
// detail. rows: [[label, value]]; a falsy value drops the line.
export default function DetailList({ rows, ...rest }) {
  return (
    <dl className="ui-detail-list" {...rest}>
      {rows.filter(([, v]) => v).map(([label, value]) => (
        <div key={label} className="ui-detail-list__row"><dt className="ui-group-label">{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}
