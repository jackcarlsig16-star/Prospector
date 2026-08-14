// Reference implementation of Phase 1's callExternalApi wrapper
// (external-api-foundation-v1) - proves the oauth2_server_to_server authType
// works against a real Zoom endpoint, not just that it's registered.
import { callExternalApi } from '../lib/callExternalApi.js';

export async function getZoomAccountUser() {
  return callExternalApi({ integration: 'zoom', method: 'GET', path: '/users/me' });
}

export async function getZoomMeetingRecordings(meetingId) {
  return callExternalApi({ integration: 'zoom', method: 'GET', path: `/meetings/${meetingId}/recordings` });
}
