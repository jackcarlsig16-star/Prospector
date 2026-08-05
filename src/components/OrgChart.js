'use strict';
import { useState } from 'react';
import {
  DndContext, closestCenter, DragOverlay,
  useDraggable, useDroppable,
  KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { C, mono } from '../constants/colors';
import { initials } from '../constants/appConfig';

// ── Hardcoded roots ────────────────────────────────────────────────────────────
const ROOT_NODES = [
  { id: 'tracy', name: 'Tracy Meng',       title: 'VP Sales' },
  { id: 'reese', name: 'Reese Dandawate',  title: 'VP Partnerships' },
];

// ── Primitive drag / drop wrappers ────────────────────────────────────────────
function DragChip({ id, data, disabled, style, children }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data, disabled });
  return (
    <div ref={setNodeRef} {...(!disabled ? listeners : {})} {...(!disabled ? attributes : {})}
      style={{ opacity: isDragging ? 0.3 : 1, cursor: disabled ? 'default' : 'grab', ...style }}>
      {children}
    </div>
  );
}

function DropZone({ id, data, accept, activeType, children, style }) {
  const valid = !activeType || accept.includes(activeType);
  const { setNodeRef, isOver } = useDroppable({ id, data, disabled: !valid });
  return (
    <div ref={setNodeRef}
      style={{
        transition: 'background 0.1s, outline-color 0.1s',
        outline: (isOver && valid) ? `2px dashed ${C.blue}` : '2px dashed transparent',
        outlineOffset: 2,
        background: (isOver && valid) ? `${C.blue}0E` : 'transparent',
        borderRadius: 7,
        ...style,
      }}>
      {children}
    </div>
  );
}

// ── BDR chip (module-scope so no hook-inside-render issue) ────────────────────
function BDRChip({ bdr, aeId, isAdmin, isMeAE, onUnassign, draggable }) {
  const chipInner = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 8px', borderRadius: 5,
      background: C.sur, border: `1px dashed ${C.brd}`,
      opacity: bdr.onLeave ? 0.4 : 1, minWidth: 110,
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: '50%',
        background: `${C.purple}18`, border: `1px solid ${C.purple}40`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: C.purple, fontWeight: 700, ...mono, flexShrink: 0,
      }}>
        {initials(bdr.name)}
      </div>
      <p style={{
        ...mono, margin: 0, fontSize: 11, color: C.mut, flex: 1,
        fontStyle: bdr.onLeave ? 'italic' : 'normal',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{bdr.name}</p>
      {(isAdmin || isMeAE) && (
        <button
          onClick={e => { e.stopPropagation(); onUnassign(bdr.id, aeId); }}
          style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1, marginLeft: 2 }}>
          ×
        </button>
      )}
    </div>
  );
  if (!draggable) return chipInner;
  return (
    <DragChip id={bdr.id} data={{ type: 'bdr', userId: bdr.id }}>
      {chipInner}
    </DragChip>
  );
}

// ── AE chip ───────────────────────────────────────────────────────────────────
function AEChip({ ae, bdrList, isAdmin, isMe, activeType, onEdit, onRemove, onUnassignBDR }) {
  const isOwner  = !!ae._isOwner;
  const canEdit  = !isOwner && (isAdmin || isMe);
  // Owner: gold. Me (non-owner): green. Everyone else: blue.
  const accentC  = isOwner ? C.gold : isMe ? C.green : C.blue;
  const inner = (
    <DropZone id={`ae-${ae.id}`} data={{ type: 'ae', targetId: ae.id }}
      accept={['bdr']} activeType={activeType}>
      <div
        onClick={() => canEdit && onEdit(ae)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '6px 9px', borderRadius: 6,
          background: `${accentC}14`,
          border: `1px solid ${ae.pendingManagerChange ? C.orange : accentC}${isOwner ? "88" : "44"}`,
          cursor: canEdit ? 'pointer' : 'default',
          opacity: ae.onLeave ? 0.4 : 1,
          minWidth: 140,
        }}>
        <div style={{
          width: 26, height: 26, borderRadius: '50%',
          background: `${accentC}20`,
          border: `1px solid ${accentC}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, color: accentC, fontWeight: 700, ...mono, flexShrink: 0,
        }}>
          {initials(ae.name)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <p style={{
              ...mono, margin: 0, fontSize: 12, color: C.txt, fontWeight: 500,
              fontStyle: ae.onLeave ? 'italic' : 'normal',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{ae.name}</p>
            {isOwner && <span style={{ ...mono, fontSize: 9, color: C.gold, flexShrink: 0 }}>you</span>}
          </div>
          {ae.title && <p style={{ ...mono, margin: 0, fontSize: 10, color: C.dim }}>{ae.title}</p>}
        </div>
        {ae.pendingManagerChange && (
          <span title="Manager change pending" style={{ ...mono, fontSize: 9, color: C.orange, flexShrink: 0 }}>⏳</span>
        )}
        {isAdmin && !isOwner && (
          <button
            onClick={e => { e.stopPropagation(); onRemove(ae.id); }}
            style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1, flexShrink: 0 }}>
            ×
          </button>
        )}
      </div>
    </DropZone>
  );

  return (
    <div style={{ marginBottom: 5 }}>
      {isAdmin
        ? <DragChip id={ae.id} data={{ type: 'ae', userId: ae.id }}>{inner}</DragChip>
        : inner}

      {bdrList.length > 0 && (
        <div style={{
          marginLeft: 14, paddingLeft: 10,
          borderLeft: `1px dashed ${C.brd}`,
          marginTop: 3,
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          {bdrList.map(bdr => (
            <BDRChip key={bdr.id} bdr={bdr} aeId={ae.id}
              isAdmin={isAdmin} isMeAE={isMe || isOwner}
              onUnassign={onUnassignBDR}
              draggable={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Manager column ─────────────────────────────────────────────────────────────
function ManagerColumn({
  manager, aeList, bdrsByAE,
  isAdmin, isMe, activeType,
  onEdit, onRemove, onUnassignBDR,
  onAddClick, addingToManager, addForm, onAddFormChange, onAddMember, onCancelAdd,
  activeUserId,
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 200, maxWidth: 270 }}>
      {/* Manager box — drop target for AE re-parenting */}
      <DropZone id={`mgr-${manager.id}`} data={{ type: 'manager', targetId: manager.id }}
        accept={['ae']} activeType={activeType}
        style={{ marginBottom: 8 }}>
        <div
          onClick={() => (isAdmin || isMe) && onEdit(manager)}
          style={{
            padding: '10px 14px', borderRadius: 7,
            border: `1px solid ${isMe ? C.green : C.goldBdr}`,
            background: isMe ? `${C.green}0C` : `${C.gold}08`,
            cursor: (isAdmin || isMe) ? 'pointer' : 'default',
          }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{
                ...mono, margin: 0, fontSize: 13, color: isMe ? C.green : C.gold, fontWeight: 600,
                fontStyle: manager.onLeave ? 'italic' : 'normal',
              }}>{manager.name}</p>
              {manager.title && (
                <p style={{ ...mono, margin: '1px 0 0', fontSize: 10, color: C.dim }}>{manager.title}</p>
              )}
              {manager.onLeave && (
                <p style={{ ...mono, margin: '2px 0 0', fontSize: 9, color: C.mut }}>on leave</p>
              )}
            </div>
            {isAdmin && (
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={e => { e.stopPropagation(); onAddClick(manager.id); }}
                  title="Add AE"
                  style={{
                    ...mono, fontSize: 12, width: 20, height: 20, borderRadius: '50%',
                    background: `${C.blue}14`, border: `1px solid ${C.blue}33`,
                    color: C.blue, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 0, lineHeight: 1,
                  }}>+</button>
                <button
                  onClick={e => { e.stopPropagation(); onRemove(manager.id); }}
                  style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>
                  ×
                </button>
              </div>
            )}
          </div>
        </div>
      </DropZone>

      {/* AEs under this manager */}
      <div style={{
        paddingLeft: 12,
        borderLeft: `2px solid ${C.brd}55`,
        minHeight: 20,
      }}>
        {aeList.length === 0 && (
          <p style={{ ...mono, fontSize: 11, color: C.dim, margin: '4px 0', fontStyle: 'italic' }}>No AEs</p>
        )}
        {aeList.map(ae => (
          <AEChip key={ae.id}
            ae={ae}
            bdrList={bdrsByAE[ae.id] || []}
            isAdmin={isAdmin}
            isMe={activeUserId === ae.id}
            activeType={activeType}
            onEdit={onEdit}
            onRemove={onRemove}
            onUnassignBDR={onUnassignBDR}
          />
        ))}
      </div>

      {/* Inline add form */}
      {addingToManager === manager.id && (
        <div style={{
          marginTop: 8, padding: '12px', background: C.sur,
          border: `1px solid ${C.brd}`, borderRadius: 6,
        }}>
          <p style={{ ...mono, margin: '0 0 8px', fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Add member</p>
          <input
            autoFocus
            value={addForm.name}
            onChange={e => onAddFormChange({ ...addForm, name: e.target.value })}
            placeholder="Name"
            style={{ ...mono, width: '100%', fontSize: 12, padding: '5px 8px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 4, color: C.txt, outline: 'none', boxSizing: 'border-box', marginBottom: 5 }}
          />
          <input
            value={addForm.title}
            onChange={e => onAddFormChange({ ...addForm, title: e.target.value })}
            placeholder="Title (optional)"
            style={{ ...mono, width: '100%', fontSize: 12, padding: '5px 8px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 4, color: C.txt, outline: 'none', boxSizing: 'border-box', marginBottom: 5 }}
          />
          <select
            value={addForm.role}
            onChange={e => onAddFormChange({ ...addForm, role: e.target.value })}
            style={{ ...mono, width: '100%', fontSize: 12, padding: '5px 8px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 4, color: C.txt, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }}>
            {['AE', 'BDR', 'SE', 'CS'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => onAddMember(manager.id)}
              style={{ ...mono, flex: 1, fontSize: 11, padding: '5px 0', background: `${C.blue}18`, border: `1px solid ${C.blue}44`, color: C.blue, borderRadius: 4, cursor: 'pointer' }}>
              Add
            </button>
            <button
              onClick={onCancelAdd}
              style={{ ...mono, fontSize: 11, padding: '5px 10px', background: 'transparent', border: `1px solid ${C.brd}`, color: C.dim, borderRadius: 4, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main OrgChart ──────────────────────────────────────────────────────────────
export default function OrgChart({ teamUsers = [], onSaveUsers, activeUser, isAdmin }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const [activeId,       setActiveId]       = useState(null);
  const [editId,         setEditId]         = useState(null);
  const [editForm,       setEditForm]       = useState({});
  const [confirmRemove,  setConfirmRemove]  = useState(null);
  const [addingToMgr,   setAddingToMgr]   = useState(null);
  const [addForm,        setAddForm]        = useState({ name: '', title: '', role: 'AE' });
  const [addError,       setAddError]       = useState(null);

  // ── Derived structure ───────────────────────────────────────────────────────
  const managers    = teamUsers.filter(u => u.role === 'Manager');
  const aes         = teamUsers.filter(u => u.role === 'AE');
  const bdrs        = teamUsers.filter(u => u.role === 'BDR');

  const aesByManager = {};
  managers.forEach(m => { aesByManager[m.id] = []; });
  const unassignedAEs = [];
  aes.forEach(ae => {
    if (ae.reportsTo && aesByManager[ae.reportsTo]) {
      aesByManager[ae.reportsTo].push(ae);
    } else {
      unassignedAEs.push(ae);
    }
  });

  const bdrsByAE = {};
  aes.forEach(ae => { bdrsByAE[ae.id] = []; });
  bdrs.forEach(bdr => {
    (bdr.assignedAEs || []).forEach(aeId => {
      if (bdrsByAE[aeId]) bdrsByAE[aeId].push(bdr);
    });
  });

  const unassignedBDRs = bdrs.filter(b => !b.assignedAEs || b.assignedAEs.length === 0);

  const activeDragUser = activeId ? teamUsers.find(u => u.id === activeId) : null;
  const activeType     = activeDragUser?.role?.toLowerCase() || null; // 'ae' | 'bdr' | 'manager'

  // ── Drag handlers ───────────────────────────────────────────────────────────
  const handleDragStart = ({ active }) => setActiveId(active.id);

  const handleDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over || !active) return;
    const dragged = teamUsers.find(u => u.id === active.id);
    if (!dragged) return;
    const targetType = over.data?.current?.type;
    const targetId   = over.data?.current?.targetId;

    if (dragged.role === 'AE' && targetType === 'manager' && targetId !== dragged.reportsTo) {
      onSaveUsers(teamUsers.map(u => u.id === dragged.id ? { ...u, reportsTo: targetId } : u));
    } else if (dragged.role === 'BDR' && targetType === 'ae') {
      const current = dragged.assignedAEs || [];
      if (current.includes(targetId)) return;
      onSaveUsers(teamUsers.map(u => u.id === dragged.id ? { ...u, assignedAEs: [...current, targetId] } : u));
    }
  };

  // ── Mutations ───────────────────────────────────────────────────────────────
  const openEdit = user => {
    if (!isAdmin && activeUser?.id !== user.id) return;
    setEditId(user.id);
    setEditForm({ name: user.name || '', title: user.title || '', role: user.role || 'AE', onLeave: !!user.onLeave });
  };

  const saveEdit = () => {
    if (!editForm.name.trim()) return;
    onSaveUsers(teamUsers.map(u =>
      u.id === editId
        ? isAdmin
          ? { ...u, ...editForm }
          : { ...u, name: editForm.name, title: editForm.title }
        : u
    ));
    setEditId(null);
  };

  const removeUser = id => {
    try {
      const removed = JSON.parse(localStorage.getItem('prospector_removed_user_ids') || '[]');
      if (!removed.includes(id)) {
        removed.push(id);
        localStorage.setItem('prospector_removed_user_ids', JSON.stringify(removed));
      }
    } catch {}
    onSaveUsers(teamUsers.filter(u => u.id !== id).map(u =>
      u.role === 'BDR' ? { ...u, assignedAEs: (u.assignedAEs || []).filter(x => x !== id) } : u
    ));
    setConfirmRemove(null);
  };

  const unassignBDR = (bdrId, aeId) => {
    onSaveUsers(teamUsers.map(u =>
      u.id === bdrId ? { ...u, assignedAEs: (u.assignedAEs || []).filter(id => id !== aeId) } : u
    ));
  };

  const addMember = managerId => {
    if (!addForm.name.trim()) return;
    const newEmail = (addForm.email || '').trim().toLowerCase();
    if (newEmail && teamUsers.some(u => u.email?.toLowerCase() === newEmail)) {
      setAddError('A user with this email already exists');
      return;
    }
    const id = `u_${Date.now()}`;
    onSaveUsers([...teamUsers, {
      id, name: addForm.name.trim(), title: addForm.title.trim(),
      email: addForm.email?.trim() || '',
      role: addForm.role, reportsTo: managerId,
      status: 'active', company: 'Prospector', assignedAEs: [],
    }]);
    setAddingToMgr(null);
    setAddForm({ name: '', title: '', role: 'AE' });
    setAddError(null);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* Root nodes */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
        {ROOT_NODES.map(root => (
          <div key={root.id} style={{
            padding: '10px 24px', borderRadius: 7,
            background: `${C.gold}08`, border: `1px solid ${C.goldBdr}`,
            textAlign: 'center',
          }}>
            <p style={{ ...mono, margin: 0, fontSize: 13, color: C.gold, fontWeight: 600 }}>{root.name}</p>
            <p style={{ ...mono, margin: '2px 0 0', fontSize: 10, color: C.dim }}>{root.title}</p>
          </div>
        ))}
      </div>

      {/* Connector line */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <div style={{ width: 1, height: 14, background: C.brd + '88' }} />
      </div>

      {/* Managers + AEs */}
      {managers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 0' }}>
          <p style={{ ...mono, fontSize: 12, color: C.dim }}>No managers yet.</p>
          {isAdmin && (
            <button
              onClick={() => onSaveUsers([...teamUsers, { id: `u_${Date.now()}`, name: 'New Manager', title: '', role: 'Manager', status: 'active', company: 'Prospector' }])}
              style={{ ...mono, marginTop: 10, fontSize: 11, padding: '6px 16px', background: `${C.blue}14`, border: `1px solid ${C.blue}44`, color: C.blue, borderRadius: 5, cursor: 'pointer' }}>
              + Add Manager
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 4 }}>
          {managers.map(mgr => (
            <ManagerColumn key={mgr.id}
              manager={mgr}
              aeList={aesByManager[mgr.id] || []}
              bdrsByAE={bdrsByAE}
              isAdmin={isAdmin}
              isMe={activeUser?.id === mgr.id}
              activeType={activeType}
              onEdit={openEdit}
              onRemove={id => setConfirmRemove(id)}
              onUnassignBDR={unassignBDR}
              onAddClick={id => { setAddingToMgr(id); setAddForm({ name: '', title: '', role: 'AE' }); }}
              addingToManager={addingToMgr}
              addForm={addForm}
              onAddFormChange={setAddForm}
              onAddMember={addMember}
              onCancelAdd={() => setAddingToMgr(null)}
              activeUserId={activeUser?.id}
            />
          ))}
          {isAdmin && (
            <button
              onClick={() => onSaveUsers([...teamUsers, { id: `u_${Date.now()}`, name: 'New Manager', title: '', role: 'Manager', status: 'active', company: 'Prospector' }])}
              style={{ ...mono, fontSize: 11, padding: '9px 14px', background: 'transparent', border: `1px dashed ${C.brd}`, color: C.dim, borderRadius: 7, cursor: 'pointer', alignSelf: 'flex-start', marginTop: 2 }}>
              + Manager
            </button>
          )}
        </div>
      )}

      {/* Unassigned AEs */}
      {unassignedAEs.length > 0 && (
        <div style={{ marginTop: 22, padding: '12px 16px', background: `${C.orange}08`, border: `1px solid ${C.orange}22`, borderRadius: 8 }}>
          <p style={{ ...mono, margin: '0 0 10px', fontSize: 10, color: C.orange, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Unassigned AEs</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {unassignedAEs.map(ae => (
              <AEChip key={ae.id}
                ae={ae}
                bdrList={bdrsByAE[ae.id] || []}
                isAdmin={isAdmin}
                isMe={activeUser?.id === ae.id}
                activeType={activeType}
                onEdit={openEdit}
                onRemove={id => setConfirmRemove(id)}
                onUnassignBDR={unassignBDR}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unassigned BDRs */}
      {unassignedBDRs.length > 0 && (
        <div style={{ marginTop: 10, padding: '12px 16px', background: `${C.purple}08`, border: `1px solid ${C.purple}22`, borderRadius: 8 }}>
          <p style={{ ...mono, margin: '0 0 10px', fontSize: 10, color: C.purple, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Unassigned BDRs — drag to an AE to assign</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {unassignedBDRs.map(bdr => (
              isAdmin
                ? (
                  <DragChip key={bdr.id} id={bdr.id} data={{ type: 'bdr', userId: bdr.id }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 5, background: C.card, border: `1px dashed ${C.brd}`, opacity: bdr.onLeave ? 0.4 : 1 }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: `${C.purple}18`, border: `1px solid ${C.purple}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: C.purple, fontWeight: 700, ...mono }}>
                        {initials(bdr.name)}
                      </div>
                      <p style={{ ...mono, margin: 0, fontSize: 12, color: C.mut, fontStyle: bdr.onLeave ? 'italic' : 'normal' }}>{bdr.name}</p>
                    </div>
                  </DragChip>
                )
                : (
                  <div key={bdr.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 5, background: C.card, border: `1px dashed ${C.brd}`, opacity: bdr.onLeave ? 0.4 : 1 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: `${C.purple}18`, border: `1px solid ${C.purple}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: C.purple, fontWeight: 700, ...mono }}>
                      {initials(bdr.name)}
                    </div>
                    <p style={{ ...mono, margin: 0, fontSize: 12, color: C.mut, fontStyle: bdr.onLeave ? 'italic' : 'normal' }}>{bdr.name}</p>
                  </div>
                )
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {teamUsers.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <p style={{ ...mono, fontSize: 13, color: C.dim, marginBottom: 12 }}>No team members yet.</p>
          {isAdmin && (
            <button
              onClick={() => onSaveUsers([{ id: `u_${Date.now()}`, name: 'New Manager', title: '', role: 'Manager', status: 'active', company: 'Prospector' }])}
              style={{ ...mono, fontSize: 12, padding: '7px 18px', background: `${C.blue}14`, border: `1px solid ${C.blue}44`, color: C.blue, borderRadius: 5, cursor: 'pointer' }}>
              + Add team member
            </button>
          )}
        </div>
      )}

      {/* Drag overlay */}
      <DragOverlay dropAnimation={null}>
        {activeDragUser ? (
          <div style={{
            padding: '6px 12px', borderRadius: 6,
            background: C.card, border: `1px solid ${C.blue}`,
            boxShadow: '0 4px 18px rgba(0,0,0,0.4)',
            ...mono, fontSize: 12, color: C.txt,
            pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>
            {activeDragUser.name}
          </div>
        ) : null}
      </DragOverlay>

      {/* ── Edit modal ── */}
      {editId && (() => {
        const u = teamUsers.find(x => x.id === editId);
        if (!u) return null;
        return (
          <div onClick={() => setEditId(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1500 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 9, padding: '22px 26px', minWidth: 290, maxWidth: 360 }}>
              <p style={{ ...mono, margin: '0 0 14px', fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {isAdmin ? 'Edit member' : 'Edit your profile'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  autoFocus
                  value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Name"
                  style={{ ...mono, fontSize: 13, padding: '7px 10px', background: C.sur, border: `1px solid ${C.brd}`, borderRadius: 5, color: C.txt, outline: 'none' }}
                />
                <input
                  value={editForm.title}
                  onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Title"
                  style={{ ...mono, fontSize: 13, padding: '7px 10px', background: C.sur, border: `1px solid ${C.brd}`, borderRadius: 5, color: C.txt, outline: 'none' }}
                />
                {isAdmin && (
                  <>
                    <select
                      value={editForm.role}
                      onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                      style={{ ...mono, fontSize: 13, padding: '7px 10px', background: C.sur, border: `1px solid ${C.brd}`, borderRadius: 5, color: C.txt, outline: 'none' }}>
                      {['AE', 'BDR', 'Manager', 'Admin', 'SE', 'CS'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, ...mono, fontSize: 12, color: C.mut, cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={!!editForm.onLeave} onChange={e => setEditForm(f => ({ ...f, onLeave: e.target.checked }))} />
                      On leave
                    </label>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button onClick={saveEdit}
                  style={{ ...mono, flex: 1, fontSize: 12, padding: '7px 0', background: `${C.blue}18`, border: `1px solid ${C.blue}44`, color: C.blue, borderRadius: 5, cursor: 'pointer' }}>
                  Save
                </button>
                <button onClick={() => setEditId(null)}
                  style={{ ...mono, fontSize: 12, padding: '7px 14px', background: 'transparent', border: `1px solid ${C.brd}`, color: C.dim, borderRadius: 5, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Confirm remove ── */}
      {confirmRemove && (() => {
        const u = teamUsers.find(x => x.id === confirmRemove);
        return (
          <div onClick={() => setConfirmRemove(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1500 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 9, padding: '22px 26px', maxWidth: 320 }}>
              <p style={{ ...mono, margin: '0 0 6px', fontSize: 14, color: C.txt }}>Remove <strong>{u?.name}</strong>?</p>
              <p style={{ ...mono, margin: '0 0 18px', fontSize: 11, color: C.dim }}>Their accounts remain but will appear unassigned.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => removeUser(confirmRemove)}
                  style={{ ...mono, flex: 1, fontSize: 12, padding: '7px 0', background: `${C.red}18`, border: `1px solid ${C.red}44`, color: C.red, borderRadius: 5, cursor: 'pointer' }}>
                  Remove
                </button>
                <button onClick={() => setConfirmRemove(null)}
                  style={{ ...mono, flex: 1, fontSize: 12, padding: '7px 0', background: 'transparent', border: `1px solid ${C.brd}`, color: C.dim, borderRadius: 5, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </DndContext>
  );
}
