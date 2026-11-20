import { useEffect, useMemo, useState } from 'react';
import SidePanel from '../../SidePanel';
import CallNotesPanel from '../../tasks/CallNotesPanel';
import { useLinkOptions } from '../../tasks/linkTargets';
import { laWeekStart } from '../../periods';
import { goalsApi } from '../goalsApi';
import { memberLookup } from '../goalsUi';

// fathom-notes-v1 F7 - "Review" on a Today row: the Intake review (CallNotesPanel) opened on a stored call note, in
// the module's right-hand drawer. extractNow: the row said Extract (the note holds no proposal yet).
export default function NoteReview({ businessId, noteId, extractNow = false, onClose, onAccepted }) {
  const [members, setMembers] = useState([]);
  const [week] = useState(() => laWeekStart());
  useEffect(() => { goalsApi.members(businessId).then(setMembers).catch(() => setMembers([])); }, [businessId]);
  const lookup = useMemo(() => memberLookup(members), [members]);
  const links = useLinkOptions(businessId, week);
  return (
    <SidePanel label="Review call notes" onClose={onClose} width={560}>
      <div data-note-review={noteId} style={{ margin: -20, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <CallNotesPanel businessId={businessId} members={members} lookup={lookup} links={links} noteId={noteId} extractNow={extractNow}
          onClose={onClose} onCreated={(n, note, out) => onAccepted(n, note, out)} onShowCalls={onClose} />
      </div>
    </SidePanel>
  );
}
