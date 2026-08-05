import { useState } from 'react';
import { C, mono } from '../constants/colors';
import { DEAL_STAGES } from '../utils/stageMap';
import { inferDealStage } from '../utils/scoringEngine';

const STAGE_ACTIVE  = "#f59e0b";   // amber
const STAGE_DONE    = "#166534";   // dark green
const STAGE_FUTURE  = "#1a1a1a";   // near-black
const STAGE_LOST_BG = "#7f1d1d";   // dark red

export default function DealStageBar({ acc, onUpdate }) {
  const [hovered, setHovered] = useState(null); // stage id
  const [sfdcWarn, setSfdcWarn] = useState(false);

  const dealStage = acc.dealStage || inferDealStage(acc);
  const isInferred = !acc.dealStage && !!dealStage;
  const isClosedLost = dealStage === "closed_lost";
  const activeIdx = isClosedLost ? -1 : DEAL_STAGES.findIndex(s => s.id === dealStage);

  const setStage = (stageId) => {
    if (acc.dealStageSource === "sfdc" && !sfdcWarn) {
      setSfdcWarn(true);
      // still proceed — warn shown inline, no block
    } else {
      setSfdcWarn(false);
    }
    onUpdate({
      ...acc,
      dealStage: stageId,
      dealStageSource: "manual",
      dealStageUpdatedAt: new Date().toISOString(),
    });
  };

  const setClosedLost = () => {
    onUpdate({
      ...acc,
      dealStage: "closed_lost",
      dealStageSource: "manual",
      dealStageUpdatedAt: new Date().toISOString(),
      stage: "Closed Lost",
    });
  };

  const activeLabel = isClosedLost
    ? "Closed Lost"
    : DEAL_STAGES[activeIdx]?.label || null;

  return (
    <div style={{ marginBottom: 10 }}>
      {/* SFDC override warning */}
      {sfdcWarn && (
        <div style={{ ...mono, fontSize: 10, color: "#5bc8f5", marginBottom: 4 }}>
          Overriding SFDC stage — SF badge will be removed.
        </div>
      )}

      {/* Segmented bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <div style={{
          flex: 1,
          display: "flex",
          gap: 2,
          borderRadius: 4,
          overflow: "hidden",
          background: isClosedLost ? STAGE_LOST_BG : "transparent",
        }}>
          {isClosedLost ? (
            <div style={{ flex: 1, height: 8, background: STAGE_LOST_BG, borderRadius: 4 }} />
          ) : (
            DEAL_STAGES.map((stage, i) => {
              const isDone   = i < activeIdx;
              const isActive = i === activeIdx;
              const bg = isDone ? STAGE_DONE : isActive ? STAGE_ACTIVE : STAGE_FUTURE;
              const border = isDone ? "#166534" : isActive ? "#f59e0b" : "#2a2a2a";
              return (
                <div
                  key={stage.id}
                  title={stage.label}
                  onMouseEnter={() => setHovered(stage.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onUpdate && setStage(stage.id)}
                  style={{
                    flex: 1,
                    height: 8,
                    background: hovered === stage.id ? (isActive ? "#fbbf24" : isDone ? "#15803d" : "#333") : bg,
                    border: `1px solid ${border}`,
                    cursor: onUpdate ? "pointer" : "default",
                    transition: "background 0.12s",
                    boxShadow: isActive ? `0 0 6px ${STAGE_ACTIVE}66` : undefined,
                    borderRadius: i === 0 ? "3px 0 0 3px" : i === DEAL_STAGES.length - 1 ? "0 3px 3px 0" : undefined,
                  }}
                />
              );
            })
          )}
        </div>

        {/* Closed Lost exit button */}
        {onUpdate && !isClosedLost && (
          <button
            onClick={setClosedLost}
            title="Mark as Closed Lost"
            style={{
              ...mono, fontSize: 10, padding: "1px 5px",
              background: "transparent",
              border: `1px solid ${C.red}44`,
              color: C.red + "88",
              borderRadius: 3,
              cursor: "pointer",
              flexShrink: 0,
              lineHeight: 1.4,
            }}>✕</button>
        )}
      </div>

      {/* Stage label row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
        {activeLabel && (
          <span style={{ ...mono, fontSize: 11, color: isClosedLost ? C.red : isInferred ? `${STAGE_ACTIVE}88` : STAGE_ACTIVE }}>
            {isInferred ? "~" : ""}{activeLabel}
          </span>
        )}
        {!activeLabel && (
          <span style={{ ...mono, fontSize: 11, color: C.dim }}>No stage set</span>
        )}
        {acc.dealStageSource === "sfdc" && !isClosedLost && (
          <span style={{ ...mono, fontSize: 9, color: "#5bc8f5", background: "#5bc8f514", border: "1px solid #5bc8f533", borderRadius: 3, padding: "1px 5px" }}>
            SF
          </span>
        )}
      </div>
    </div>
  );
}
