// Reference implementation of Phase 1's callExternalApi wrapper
// (external-api-foundation-v1) - proves the oauth2_server_to_server authType
// works against a real Zoom endpoint, not just that it's registered.
import { callExternalApi } from '../lib/callExternalApi.js';

export async function getZoomAccountUser() {
  return callExternalApi({ integration: 'zoom', method: 'GET', path: '/users/me' });
}

// Zoom meeting UUIDs (as opposed to plain numeric meeting IDs) can start
// with '/' or contain '//' - Zoom's own docs require double-encoding those
// in the URL path or the request 404s. A plain numeric ID never needs it.
function encodeMeetingId(meetingId) {
  return /^\d+$/.test(meetingId) ? meetingId : encodeURIComponent(encodeURIComponent(meetingId));
}

export async function getZoomMeetingRecordings(meetingId) {
  return callExternalApi({ integration: 'zoom', method: 'GET', path: `/meetings/${encodeMeetingId(meetingId)}/recordings` });
}

// zoom-meet-auto-ingest-v1, Step 2/3 - the webhook payload has no
// participant list (confirmed live, Phase 0 audit), so this Reports API
// call is the only source of real attendee emails for Tier 1/2 attribution.
// Needs report:read:list_meeting_participants:admin, confirmed granted on a
// fresh token separately from cloud_recording:read:recording:admin.
export async function getZoomMeetingParticipants(meetingId) {
  return callExternalApi({ integration: 'zoom', method: 'GET', path: `/report/meetings/${encodeMeetingId(meetingId)}/participants`, query: { page_size: 300 } });
}
