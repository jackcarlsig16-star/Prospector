// homelover-clients-v1 - a Client is an employer row with client fields (C1). Status drives the pipeline stage, one
// direction only (C2); the Apollo stage names are a hint for whoever mirrors it in Apollo by hand.
export const CLIENT_STATUSES = ['verbal_yes', 'agreement_sent', 'signed', 'launched'];
export const CLIENT_STATUS_LABEL = { verbal_yes: 'Verbal yes', agreement_sent: 'Agreement sent', signed: 'Signed', launched: 'Launched' };
export const CLIENT_STAGE = { verbal_yes: 'verbal', agreement_sent: 'contract', signed: 'contract', launched: 'launched' };
export const APOLLO_STAGE_HINT = { verbal_yes: 'Negotiation', agreement_sent: 'Contract Sent', signed: 'Closed Won', launched: 'Current Client' };

export const CLIENT_FILE_KINDS = ['agreement', 'schedule', 'invoice', 'financial', 'other'];
export const CLIENT_FILE_KIND_LABEL = { agreement: 'Agreement', schedule: 'Schedule', invoice: 'Invoice', financial: 'Financial', other: 'Other' };
// Matches the client-files bucket and the sales_client_files.mime check (20261103_homelover_clients_v1.sql).
export const CLIENT_FILE_MIMES = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
};
export const CLIENT_FILE_MAX_BYTES = 20 * 1024 * 1024;
