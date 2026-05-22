"use client";

import { Handle, NodeResizer, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { GraphNodeFieldControl } from "./graph-node-field";
import { GraphNodeDisplayAny } from "./graph-node-display-any";
import { GraphNodeHelp } from "./graph-node-help";
import { GraphNodeMediaPreview, dropNodeImage, readGraphMediaDragPayload } from "./graph-node-media-preview";
import type { GraphNodeData, StudioNode } from "./types";
import { computeGraphNodeLayout, graphNodeUsesContentAutoHeight } from "./utils/graph-node-layout";
import { graphExecutionModeClass, graphExecutionModeLabel, normalizeGraphExecutionMode } from "./utils/graph-node-execution";
import { graphPreviewHeaderFieldIds, graphVisibleFieldMetrics } from "./utils/graph-node-fields";
import { visibleGraphInputPorts, visibleGraphOutputPorts } from "./utils/graph-node-ports";
import { inputGraphHandleId, outputGraphHandleId } from "./utils/graph-port-handles";
import { graphPortAccepts } from "./utils/graph-port-compatibility";
import { graphNodeHasTracingBorder, graphNodeStatusClass, graphNodeStatusForExecutionMode } from "./utils/graph-node-status";
import { graphNodePricingLabel } from "./utils/graph-pricing";
import { graphNodeHeaderKindLabel } from "./utils/graph-node-header";
import { graphPromptAdvancedSummary, graphPromptNodeHeaderSummary, graphPromptRuntimeFieldOverride } from "./utils/graph-prompt-provider";
import { graphPromptRecipeFieldOverride, graphPromptRecipeImageWarning, graphPromptRecipeSelectionSummary } from "./utils/graph-prompt-recipe";

export function GraphNode({ id, data, selected }: NodeProps<StudioNode>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeHeaderRef = useRef<HTMLDivElement | null>(null);
  const nodeBodyRef = useRef<HTMLDivElement | null>(null);
  const lastMeasuredHeightRef = useRef<number | null>(null);
  const definition = data.definition;
  const executionMode = normalizeGraphExecutionMode(data.executionMode);
  const status = graphNodeStatusForExecutionMode(data.status, executionMode);
  const statusClass = graphNodeStatusClass(status);
  const executionClass = graphExecutionModeClass(executionMode);
  const hasTracingBorder = graphNodeHasTracingBorder(status);
  const collapsed = Boolean(data.collapsed);
  const advancedExpanded = Boolean(data.advancedExpanded);
  const isLoadImage = definition.type === "media.load_image";
  const isDisplayAny = definition.type === "display.any";
  const isLoadMedia = definition.type === "media.load_image" || definition.type === "media.load_video" || definition.type === "media.load_audio";
  const isSaveMedia = definition.type === "media.save_image" || definition.type === "media.save_video" || definition.type === "media.save_audio" || definition.type === "media.save_music_track";
  const displayTitle = data.customTitle?.trim() || definition.title;
  const showPreview = !isDisplayAny && (isLoadMedia || isSaveMedia || Boolean(definition.ui?.preview));
  const connectedInputPortIds = data.connectedInputPorts ?? [];
  const connectedInputPorts = new Set(connectedInputPortIds);
  const connectedOutputPorts = new Set(data.connectedOutputPorts ?? []);
  const inputConnectionCount = (portId: string) => connectedInputPortIds.filter((inputPortId) => inputPortId === portId).length;
  const activeConnection = data.activeConnection ?? null;
  const connectableFieldIds = new Set(definition.fields.filter((field) => field.connectable || field.port_type).map((field) => field.id));
  const fieldMetrics = graphVisibleFieldMetrics(definition, data.fields, connectedInputPortIds, {
    advancedExpanded,
    previewHeaderFieldIds: graphPreviewHeaderFieldIds(definition),
    extraLayoutRows: definition.type === "prompt.recipe" && graphPromptRecipeSelectionSummary(definition, data.fields) ? 2 : 0,
  });
  const previewHeaderFields = fieldMetrics.previewHeaderFields;
  const primaryBodyFields = fieldMetrics.primaryBodyFields.filter((field) => field.type !== "asset_picker" && field.type !== "reference_media_picker");
  const advancedBodyFields = fieldMetrics.advancedBodyFields.filter((field) => field.type !== "asset_picker" && field.type !== "reference_media_picker");
  const visibleInputPorts = visibleGraphInputPorts(definition, data.fields).filter((port) => !connectableFieldIds.has(port.id));
  const collapsedInputPorts = visibleGraphInputPorts(definition, data.fields);
  const effectiveOutputPorts = visibleGraphOutputPorts(definition, data.fields);
  const inputPortKey = collapsedInputPorts.map((port) => port.id).join("|");
  const outputPortKey = effectiveOutputPorts.map((port) => port.id).join("|");
  const connectedInputPortKey = connectedInputPortIds.join("|");
  const contentMeasureKey = [
    advancedExpanded ? "advanced" : "basic",
    fieldMetrics.layoutFieldCount,
    fieldMetrics.textareaCount,
    connectedInputPortKey,
  ].join("|");
  const nodeLayout = computeGraphNodeLayout(definition, undefined, {
    visibleFieldCount: fieldMetrics.layoutFieldCount,
    visiblePortCount: visibleInputPorts.length + effectiveOutputPorts.length,
    textareaCount: fieldMetrics.textareaCount,
  });
  const pricingLabel = graphNodePricingLabel(data.pricingEstimate);
  const showPricingBadge = Boolean(pricingLabel && definition.source?.kind === "kie_model");
  const activityTone = data.activityTone ?? "muted";
  const referenceBadges = data.referenceBadges ?? [];
  const promptRecipeSummary = definition.type === "prompt.recipe" ? graphPromptRecipeSelectionSummary(definition, data.fields) : null;
  const promptRecipeImageWarning = definition.type === "prompt.recipe" ? graphPromptRecipeImageWarning(definition, data.fields, connectedInputPortIds) : null;
  const promptHeaderSummary = graphPromptNodeHeaderSummary(definition.type, data.fields);
  const nodeKindLabel = promptHeaderSummary ?? graphNodeHeaderKindLabel(definition);
  const activityLabel = status === "idle" ? null : data.activityLabel;
  const collapsedHeight = 54;
  const nodeStyle = {
    ...nodeLayout.style,
    ...(collapsed ? { height: collapsedHeight, minHeight: collapsedHeight } : {}),
    ...(data.accentColor ? { "--graph-node-accent": data.accentColor, "--graph-node-handle": data.accentColor } : {}),
    ...(data.nodeColor ? { "--graph-node-surface": data.nodeColor } : {}),
    ...(data.nodeHeaderColor ? { "--graph-node-header-bg": data.nodeHeaderColor } : {}),
  } as CSSProperties;
  const activityTime = typeof data.activityDetail === "string" && /^\d+(?:\.\d+)?s$/.test(data.activityDetail) ? data.activityDetail : null;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => updateNodeInternals(id));
    return () => window.cancelAnimationFrame(frame);
  }, [advancedExpanded, collapsed, id, inputPortKey, outputPortKey, updateNodeInternals]);
  useLayoutEffect(() => {
    if (collapsed || !graphNodeUsesContentAutoHeight(definition)) {
      lastMeasuredHeightRef.current = null;
      return;
    }
    const header = nodeHeaderRef.current;
    const body = nodeBodyRef.current;
    if (!header || !body) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const requiredHeight = Math.ceil(header.offsetHeight + body.scrollHeight + 2);
      if (requiredHeight <= 0) return;
      if (lastMeasuredHeightRef.current != null && Math.abs(lastMeasuredHeightRef.current - requiredHeight) <= 2) return;
      lastMeasuredHeightRef.current = requiredHeight;
      data.onEnsureNodeHeight?.(id, requiredHeight);
    };
    frame = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    });
    observer.observe(header);
    observer.observe(body);
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [collapsed, contentMeasureKey, data.fields, data.onEnsureNodeHeight, data.outputSnapshot, data.errorMessage, id, inputPortKey, outputPortKey]);
  const inputHandleClass = (port: GraphNodeData["definition"]["ports"]["inputs"][number]) => {
    const compatible = activeConnection?.from === "output" && graphPortAccepts(activeConnection.portType, port);
    const connected = connectedInputPorts.has(port.id);
    return `graph-handle graph-handle-${port.type} ${connected ? "graph-handle-connected" : ""} ${compatible ? "graph-handle-compatible" : ""}`;
  };
  const outputHandleClass = (port: GraphNodeData["definition"]["ports"]["outputs"][number]) => {
    const compatible = activeConnection?.from === "input" && (activeConnection.portType === "any" || port.type === "any" || port.type === activeConnection.portType);
    const connected = connectedOutputPorts.has(port.id);
    return `graph-handle graph-handle-${port.type} ${connected ? "graph-handle-connected" : ""} ${compatible ? "graph-handle-compatible" : ""}`;
  };
  const inputHandleProps = (port: GraphNodeData["definition"]["ports"]["inputs"][number]) => {
    const connectedCount = inputConnectionCount(port.id);
    const canAcceptMore = port.array ? port.max == null || connectedCount < port.max : connectedCount === 0;
    return {
      isConnectableStart: false,
      isConnectableEnd: canAcceptMore,
      ...inputRewireGestureProps(port.id),
    };
  };
  const inputRewireGestureProps = (portId: string) => {
    const connected = connectedInputPorts.has(portId);
    const startRewire = (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      data.onInputRewireStart?.(id, portId, { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId });
    };
    return {
      onPointerDownCapture: connected ? startRewire : undefined,
    };
  };
  const renderField = (field: GraphNodeData["definition"]["fields"][number]) => {
    const fieldConnected = connectedInputPorts.has(field.id);
    const fieldPort = definition.ports.inputs.find((port) => port.id === field.id);
    const fieldOverride = graphPromptRecipeFieldOverride(definition, data.fields, field);
    const runtimeFieldOverride = graphPromptRuntimeFieldOverride(definition.type, data.fields, field);
    const fieldLabel = fieldOverride?.label ?? field.label;
    const fieldHelpText = fieldOverride?.helpText ?? runtimeFieldOverride?.helpText ?? field.help_text;
    return (
      <label
        className={`graph-node-field ${fieldPort ? "graph-node-field-connectable" : ""} ${fieldConnected ? "graph-node-field-connected nodrag nopan" : ""}`}
        key={field.id}
        data-graph-node-id={fieldPort ? id : undefined}
        data-input-port={fieldPort?.id}
        data-rewire-port={fieldPort && fieldConnected ? fieldPort.id : undefined}
        {...(fieldPort ? inputRewireGestureProps(fieldPort.id) : {})}
      >
        {fieldPort ? <Handle id={inputGraphHandleId(fieldPort.id)} type="target" position={Position.Left} className={inputHandleClass(fieldPort)} {...inputHandleProps(fieldPort)} /> : null}
        <span>
          {fieldLabel}
          {field.required ? " *" : ""}
        </span>
        <GraphNodeFieldControl
          nodeId={id}
          definition={definition}
          nodeFields={data.fields}
          field={field}
          value={data.fields[field.id]}
          disabled={fieldConnected}
          onFieldChange={data.onFieldChange}
          onSetFields={data.onSetFields}
        />
        {fieldHelpText ? <small className="graph-node-field-note">{fieldHelpText}</small> : null}
      </label>
    );
  };
  const advancedSummary = graphPromptAdvancedSummary(definition.type, data.fields);
  return (
    <div
      className={`graph-node ${statusClass} ${executionClass} ${hasTracingBorder ? "graph-node-tracing" : ""} ${showPreview ? "graph-node-media-container" : ""} ${collapsed ? "graph-node-collapsed" : ""}`}
      style={nodeStyle}
      data-testid={`graph-node-${definition.type}`}
      onDragOver={(event) => {
        if (!isLoadMedia) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        if (!isLoadMedia) return;
        event.preventDefault();
        event.stopPropagation();
        const graphMedia = readGraphMediaDragPayload(event.dataTransfer);
        const expectedMediaType = definition.type.replace("media.load_", "");
        if (graphMedia && (!graphMedia.mediaType || graphMedia.mediaType === expectedMediaType)) {
          data.onSetFields?.(
            id,
            graphMedia.source === "reference" ? { reference_id: graphMedia.id, asset_id: "" } : { asset_id: graphMedia.id, reference_id: "" },
          );
          return;
        }
        const file = event.dataTransfer.files?.[0];
        if (file?.type.startsWith("image/") && expectedMediaType === "image") {
          dropNodeImage(id, data, file);
        }
      }}
    >
      <NodeResizer
        isVisible={!collapsed}
        minWidth={nodeLayout.minWidth}
        minHeight={collapsed ? collapsedHeight : nodeLayout.minHeight}
        maxWidth={nodeLayout.maxWidth}
        maxHeight={nodeLayout.maxHeight}
        keepAspectRatio={false}
        handleClassName="graph-node-resize-handle"
        lineClassName="graph-node-resize-line"
      />
      <div className="graph-node-activity-ring" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      {referenceBadges.length || showPricingBadge ? (
        <div className="graph-node-reference-badges" aria-label="Node badges">
          {showPricingBadge ? (
            <span className="graph-node-reference-badge graph-node-price-floating-badge" title={`Estimated model cost: ${pricingLabel}`}>
              {pricingLabel}
            </span>
          ) : null}
          {referenceBadges.slice(0, 3).map((badge) => (
            <span
              className={`graph-node-reference-badge graph-node-reference-badge-${badge.mediaType}`}
              key={badge.id}
              title={`${badge.targetTitle}: ${badge.token} on ${badge.targetPortLabel}`}
            >
              {badge.label}
            </span>
          ))}
          {referenceBadges.length > 3 ? (
            <span className="graph-node-reference-badge graph-node-reference-badge-more" title={referenceBadges.map((badge) => `${badge.targetTitle}: ${badge.token}`).join("\n")}>
              +{referenceBadges.length - 3}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="graph-node-header" ref={nodeHeaderRef}>
        <div className="graph-node-header-text">
          {data.isRenamingTitle ? (
            <input
              className="graph-node-title-input nodrag nopan"
              autoFocus
              value={data.titleDraft ?? displayTitle}
              onChange={(event) => data.onRenameNodeDraftChange?.(event.target.value)}
              onBlur={() => data.onCommitRenameNode?.()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  data.onCommitRenameNode?.();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  data.onCancelRenameNode?.();
                }
              }}
            />
          ) : (
            <div
              className="graph-node-title"
              title="Double-click to rename"
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                data.onStartRenameNode?.(id);
              }}
            >
              {displayTitle}
            </div>
          )}
          <div className="graph-node-kind" title={nodeKindLabel}>
            {nodeKindLabel}
          </div>
        </div>
        <div className="graph-node-header-actions">
          <GraphNodeHelp definition={definition} fields={data.fields} />
          {pricingLabel && !showPricingBadge ? <span className="graph-node-status graph-node-price-chip">{pricingLabel}</span> : null}
          {executionMode !== "enabled" ? <span className="graph-node-status graph-node-execution-chip">{graphExecutionModeLabel(executionMode)}</span> : null}
          {status !== "idle" ? <span className={`graph-node-status graph-node-activity-chip graph-node-activity-chip-${activityTone}`}>{activityLabel || status}</span> : null}
          {activityTime ? <span className="graph-node-status graph-node-time-chip">{activityTime}</span> : null}
          <button
            className="graph-node-collapse-toggle nodrag nopan"
            type="button"
            aria-label={collapsed ? "Expand node" : "Collapse node"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand node" : "Collapse node"}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              data.onToggleCollapsed?.(id);
            }}
          />
        </div>
        {collapsed && (collapsedInputPorts.length || effectiveOutputPorts.length) ? (
          <div className="graph-node-collapsed-handles">
            {collapsedInputPorts.length ? (
              <>
                <span className="graph-node-collapsed-pin-visual graph-node-collapsed-pin-visual-input" data-testid="graph-node-collapsed-input-pin" aria-hidden="true" />
                <div className="graph-node-collapsed-handle-stack graph-node-collapsed-handle-stack-inputs graph-node-collapsed-handle-stack-pin">
                  {collapsedInputPorts.map((port) => (
                    <div
                      className="graph-node-collapsed-handle-row"
                      key={port.id}
                      title={`${port.label} input`}
                      data-graph-node-id={id}
                      data-input-port={port.id}
                      data-rewire-port={connectedInputPorts.has(port.id) ? port.id : undefined}
                      {...inputRewireGestureProps(port.id)}
                    >
                      <Handle id={inputGraphHandleId(port.id)} type="target" position={Position.Left} className={`${inputHandleClass(port)} graph-handle-collapsed-pin`} {...inputHandleProps(port)} />
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {effectiveOutputPorts.length ? (
              <>
                <span className="graph-node-collapsed-pin-visual graph-node-collapsed-pin-visual-output" data-testid="graph-node-collapsed-output-pin" aria-hidden="true" />
                <div className="graph-node-collapsed-handle-stack graph-node-collapsed-handle-stack-outputs graph-node-collapsed-handle-stack-pin">
                  {effectiveOutputPorts.map((port) => (
                    <div className="graph-node-collapsed-handle-row" key={port.id} title={`${port.label} output`}>
                      <Handle id={outputGraphHandleId(port.id)} type="source" position={Position.Right} className={`${outputHandleClass(port)} graph-handle-collapsed-pin`} isConnectableStart isConnectableEnd={false} />
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {!collapsed ? <div className="graph-node-body" ref={nodeBodyRef}>
        {visibleInputPorts.length || effectiveOutputPorts.length ? (
          <div className="graph-node-port-band">
            <div className="graph-node-port-stack graph-node-port-stack-inputs">
              {visibleInputPorts.map((port) => (
                <div
                  className={`graph-node-port-row graph-node-port-input ${connectedInputPorts.has(port.id) ? "nodrag nopan graph-node-port-connected" : ""} ${
                    activeConnection?.from === "output" && inputHandleClass(port).includes("graph-handle-compatible") ? "graph-port-compatible" : ""
                  }`}
                  key={port.id}
                  data-graph-node-id={id}
                  data-input-port={port.id}
                  data-rewire-port={connectedInputPorts.has(port.id) ? port.id : undefined}
                  {...inputRewireGestureProps(port.id)}
                >
                  <Handle id={inputGraphHandleId(port.id)} type="target" position={Position.Left} className={inputHandleClass(port)} {...inputHandleProps(port)} />
                  <span>{port.label}</span>
                </div>
              ))}
            </div>
            <div className="graph-node-port-stack graph-node-port-stack-outputs">
              {effectiveOutputPorts.map((port) => (
                <div
                  className={`graph-node-port-row graph-node-port-output ${activeConnection?.from === "input" && outputHandleClass(port).includes("graph-handle-compatible") ? "graph-port-compatible" : ""}`}
                  key={port.id}
                >
                  <span>{port.label}</span>
                  <Handle id={outputGraphHandleId(port.id)} type="source" position={Position.Right} className={outputHandleClass(port)} isConnectableStart isConnectableEnd={false} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {previewHeaderFields.length ? (
          <div className="graph-node-preview-fields">
            {previewHeaderFields.map((field) => (
              <label className="graph-node-field graph-node-field-compact" key={field.id}>
                <span>{field.label}</span>
                <GraphNodeFieldControl
                  nodeId={id}
                  definition={definition}
                  nodeFields={data.fields}
                  field={field}
                  value={data.fields[field.id]}
                  onFieldChange={data.onFieldChange}
                  onSetFields={data.onSetFields}
                />
              </label>
            ))}
          </div>
        ) : null}
        {showPreview ? <GraphNodeMediaPreview nodeId={id} data={data} isLoadMedia={isLoadMedia} isSaveMedia={isSaveMedia} /> : null}
        {isDisplayAny ? <GraphNodeDisplayAny data={data} /> : null}
        {promptRecipeSummary ? (
          <div className="graph-node-inline-summary">
            <strong>{promptRecipeSummary.title}</strong>
            <span>{promptRecipeSummary.subtitle}</span>
            <p>{promptRecipeSummary.description}</p>
            <ul>
              {promptRecipeSummary.details.map((detail) => <li key={detail}>{detail}</li>)}
            </ul>
          </div>
        ) : null}
        {promptRecipeImageWarning ? <div className="graph-node-warning">{promptRecipeImageWarning}</div> : null}
        {primaryBodyFields.map(renderField)}
        {advancedBodyFields.length ? (
          <div className="graph-node-advanced">
            <button
              className="graph-node-advanced-toggle nodrag nopan"
              type="button"
              aria-expanded={advancedExpanded}
              data-testid="graph-node-advanced-toggle"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                data.onToggleAdvancedExpanded?.(id);
              }}
            >
              <span>Advanced</span>
              <small>{advancedSummary}</small>
            </button>
            {advancedExpanded ? <div className="graph-node-advanced-fields">{advancedBodyFields.map(renderField)}</div> : null}
          </div>
        ) : null}
        {data.errorMessage ? <div className="graph-node-error">{data.errorMessage}</div> : null}
      </div> : null}
    </div>
  );
}
