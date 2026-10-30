import React from 'react';
import { Icon } from '../HkMarks';
import { HeatChip } from '../signals/Heat';
import OwnerChip from './OwnerChip';
import { marketOf, industryOf, fitOf, contactOf } from './labelRules';

// grow-ui-refresh-v1 U1 - one label set, one component, in the mockup's order: Target · Industry (or Category, J6) ·
// [Category on the brand page / expanded row] · Market · Heat · Fit · Contact · [Owner]. Each chip reads "Label value";
// every color carries its word.
const Kv = ({ k, v, tone = 'line', ...attrs }) => <span className={`hk-label hk-label--${tone}`} {...attrs}><span className="hk-label__k">{k}</span> {v}</span>;

export default function BrandLabels({ brand: b, owner, withCategory = false, withOwner = false }) {
  const ind = industryOf(b), fit = fitOf(b), contact = contactOf(b);
  return (
    <span className="hk-labels" data-hk-labels={b.id}>
      {b.targeted_at
        ? <span className="hk-label hk-label--target" data-hk-label="target"><Icon name="target" size={13} /> Target</span>
        : <span className="hk-label hk-label--grey" data-hk-label="target"><Icon name="target" size={13} /> Not a target</span>}
      {ind && <Kv k={ind.key} v={ind.value} data-hk-label="industry" />}
      {withCategory && ind?.key === 'Industry' && b.category && <Kv k="Category" v={b.category} data-hk-label="category" />}
      <Kv k="Market" v={marketOf(b)} data-hk-label="market" />
      <HeatChip band={b.heat_band || 'cold'} showCold />
      <span className={`hk-label hk-label--${fit.tone}`} data-hk-label="fit">{fit.words}</span>
      {contact.ok
        ? <span className="hk-label hk-label--green" data-hk-label="contact"><Icon name="person" size={13} /> <span className="hk-label__k">Contact</span> {contact.words}</span>
        : <span className="hk-label hk-label--block" data-hk-label="contact"><Icon name="person" size={13} /> {contact.words}</span>}
      {withOwner && <OwnerChip owner={owner} hint={b.owner_hint} size={16} chip />}
    </span>
  );
}
