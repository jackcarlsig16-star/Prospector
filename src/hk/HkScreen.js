import React from 'react';
import { Icon, Sprout, Avatar } from './HkMarks';
import { SETTINGS_SECTIONS, chicagoGreeting } from './hkScreens';
import { ROLE_LABELS, roleAtLeast } from '../constants/roles';
import BrandsScreen from './brands/BrandsScreen';
import BrandPage from './brands/BrandPage';
import SponsorsScreen from './screens/SponsorsScreen';
import ReviewScreen from './screens/ReviewScreen';
import ActivityScreen from './screens/ActivityScreen';
import PitchSettings from './screens/PitchSettings';
import DraftsScreen from './screens/DraftsScreen';
import RepliesScreen from './screens/RepliesScreen';
import ConnectionsSettings from './screens/ConnectionsSettings';
import InboxScreen from './screens/InboxScreen';
import TodayScreen from './screens/TodayScreen';
import FollowupSettings from './screens/FollowupSettings';
import DigestSettings from './screens/DigestSettings';

// hkos-project-shell-v1 S5 - one screen: the page header and an empty state (no buttons in Phase 0; each later SPEC
// adds its own), or Settings with its Members / Modules sections.
function Empty({ title, line }) {
  return (
    <div className="hk-empty" data-hk-empty>
      <Sprout size={40} />
      <p className="hk-empty__title">{title}</p>
      <p className="hk-empty__line">{line}</p>
    </div>
  );
}

function Header({ title, line }) {
  return (
    <header>
      <h1 className="hk-head__title">{title}</h1>
      <p className="hk-head__line">{line}</p>
    </header>
  );
}

function Members({ shell, onOpenAdmin }) {
  const canManage = roleAtLeast(shell.me.role, 'admin');
  return (
    <section aria-label="Members">
      <h2 className="hk-section-title">Members</h2>
      <div className="hk-rows">
        {shell.members.map((m, i) => (
          <div key={m.user_id || `invited-${i}`} className="hk-row" data-hk-member>
            <Avatar name={m.first_name} index={m.palette_index} size={34} />
            <span className="hk-row__name">{m.first_name}</span>
            <span className="hk-meta">{ROLE_LABELS[m.role] || m.role}</span>
            {!m.signed_up && <span className="hk-row__end hk-meta">Hasn't signed in yet</span>}
          </div>
        ))}
      </div>
      {canManage && <p style={{ marginTop: 14 }}><button type="button" className="hk-btn hk-link" onClick={onOpenAdmin}>Invite or change roles</button></p>}
    </section>
  );
}

function Modules({ shell }) {
  return (
    <section aria-label="Modules">
      <h2 className="hk-section-title">Modules</h2>
      <div className="hk-rows">
        {shell.modules.map(m => (
          <div key={m.key} className="hk-row" data-hk-module={m.key}>
            <span className="hk-row__name">{m.label}</span>
            <span className="hk-row__end hk-meta">
              {m.on ? <>On {m.locked && <Icon name="lock" size={16} label="Locked" />}</> : 'Off · not built yet'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function HkScreen({ screen, section, brandId, businessId, owner, compact, shell, gmail, syncing, onSync, onGmailChanged, onOpenConnections, onInboxUnread, onSection, onOpenAdmin, onOpenBrand, onGo, onTodayCounts, intent, onIntentDone, now }) {
  const canEdit = roleAtLeast(shell.me.role, 'member');
  if (screen.id === 'today') { const g = chicagoGreeting(now, shell.me.first_name); return <><Header title={g.title} line={g.date} /><TodayScreen businessId={businessId} shell={shell} owner={owner} compact={compact} gmail={gmail} onOpenBrand={onOpenBrand} onGo={onGo} onOpenConnections={onOpenConnections} onCounts={onTodayCounts} /></>; }
  if (screen.id === 'inbox') return <><Header title="Inbox" line={SCREEN_LINES.inbox} /><InboxScreen businessId={businessId} shell={shell} gmail={gmail} compact={compact} canEdit={canEdit} onOpenBrand={onOpenBrand} onOpenConnections={onOpenConnections} onUnread={onInboxUnread} /></>;
  if (screen.id === 'brands' && brandId) return <BrandPage businessId={businessId} brandId={brandId} shell={shell} gmail={gmail} canEdit={canEdit} onBack={() => onOpenBrand(null)} onGmailChanged={onGmailChanged} />;
  if (screen.id === 'drafts') return <><Header title="Drafts" line={SCREEN_LINES.drafts} /><DraftsScreen businessId={businessId} shell={shell} compact={compact} onOpenBrand={onOpenBrand} /></>;
  if (screen.id === 'replies') return <><Header title="Replies" line={SCREEN_LINES.replies} /><RepliesScreen businessId={businessId} shell={shell} owner={owner} compact={compact} onOpenBrand={onOpenBrand} /></>;
  if (screen.id === 'brands') {
    return (
      <>
        <Header title="Brands" line={SCREEN_LINES.brands} />
        <BrandsScreen businessId={businessId} shell={shell} owner={owner} compact={compact} canEdit={canEdit} onOpenBrand={onOpenBrand} intent={intent} onIntentDone={onIntentDone} />
      </>
    );
  }
  if (screen.id === 'pipeline') return <><Header title="Pipeline" line={SCREEN_LINES.pipeline} /><BrandsScreen pipeline businessId={businessId} shell={shell} owner={owner} compact={compact} canEdit={canEdit} onOpenBrand={onOpenBrand} /></>;
  if (screen.id === 'sponsors') return <><Header title="Sponsors" line={SCREEN_LINES.sponsors} /><SponsorsScreen businessId={businessId} shell={shell} canEdit={canEdit} onOpenBrand={onOpenBrand} /></>;
  if (screen.id === 'review') return <><Header title="Review" line={SCREEN_LINES.review} /><ReviewScreen businessId={businessId} shell={shell} canEdit={canEdit} compact={compact} onOpenBrand={onOpenBrand} onGo={onGo} intent={intent} onIntentDone={onIntentDone} /></>;
  if (screen.id === 'activity') return <><Header title="Activity" line={SCREEN_LINES.activity} /><ActivityScreen businessId={businessId} shell={shell} owner={owner} compact={compact} onOpenBrand={onOpenBrand} /></>;
  if (screen.id === 'settings') {
    return (
      <>
        <Header title="Settings" line="Who is in this workspace and which modules are on." />
        <div className="hk-settings">
          <nav className="hk-subnav" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map(([id, label]) => (
              <button key={id} type="button" className="hk-btn hk-subnav__item" aria-current={section === id ? 'page' : undefined} onClick={() => onSection(id)}>{label}</button>
            ))}
          </nav>
          <div>{section === 'modules' ? <Modules shell={shell} /> : section === 'followups' ? <FollowupSettings businessId={businessId} shell={shell} canEdit={canEdit} /> : section === 'digest' ? <DigestSettings businessId={businessId} shell={shell} canEdit={canEdit} /> : section === 'pitch' ? <PitchSettings businessId={businessId} shell={shell} canEdit={canEdit} /> : section === 'connections' ? <ConnectionsSettings businessId={businessId} shell={shell} gmail={gmail} syncing={syncing} onSync={onSync} onOpenConnections={onOpenConnections} onGmailChanged={onGmailChanged} canEdit={canEdit} /> : <Members shell={shell} onOpenAdmin={onOpenAdmin} />}</div>
        </div>
      </>
    );
  }
  const head = screen.id === 'today' ? chicagoGreeting(now, shell.me.first_name) : null;
  return (
    <>
      <Header title={head ? head.title : screen.label} line={head ? head.date : SCREEN_LINES[screen.id]} />
      <Empty title={screen.emptyTitle} line={screen.emptyLine} />
    </>
  );
}

const SCREEN_LINES = {
  inbox: 'Your own HumanKind Gmail, read live. Only you see it.',
  replies: 'Brands that wrote back.',
  drafts: 'Drafts waiting in Gmail for you to send.',
  pipeline: 'Every brand by stage.',
  brands: 'Every brand and who owns it.',
  sponsors: 'Current sponsors, founding partners and do-not-contact.',
  review: 'Things to check before they go anywhere.',
  activity: 'Everything that changed, and who changed it.',
};
