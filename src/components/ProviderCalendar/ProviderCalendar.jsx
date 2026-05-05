/**
 * ProviderCalendar.jsx
 *
 * Pure presentational calendar component — receives all data as props
 * from CalendarPage.js which handles all Sharetribe SDK calls via Redux.
 *
 * Props:
 *   listings             — provider's own listings for the dropdown
 *   platformBookings     — confirmed transactions from Sharetribe
 *   availabilityExceptions — blocked time slots
 *   manualBookings       — locally persisted manual bookings
 *   loading              — bool, shows loading overlay
 *   saving               — bool, disables form during save
 *   error                — string or null
 *   onSaveManual(data)   — called when manual booking form is submitted
 *   onDeleteManual(id, extendedProps) — called when a manual booking is deleted
 */

import React, { useState, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';

const EVENT_COLORS = {
  platform:    { bg: 'var(--marketplaceColor)', border: 'var(--marketplaceColorLight)', text: '#ffffff' },
  manual:      { bg: '#378ADD', border: '#185FA5', text: '#ffffff' },
  unavailable: { bg: '#FCEBEB', border: '#F09595', text: '#A32D2D' },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTime(date) {
  if (!date) return '';
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Returns the effective seat capacity for [startTime, endTime], per calendar day:
//   exception seats take priority over plan entries for any day they cover.
// Returns 0 if any covered day is unavailable, null if capacity can't be determined.
function getSlotCapacity(availabilityPlan, startTime, endTime, availabilityExceptions, listingId) {
  if (!startTime || !endTime) return null;

  const start = new Date(startTime);
  const end   = new Date(endTime);
  if (isNaN(start) || isNaN(end) || start >= end) return null;

  const entries = availabilityPlan?.entries || [];
  const relevantExceptions = (availabilityExceptions || []).filter(
    ex => ex.listingId === listingId && new Date(ex.start) < end && new Date(ex.end) > start
  );

  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  let min = Infinity;
  let daysChecked = 0;

  while (cursor.getTime() < end.getTime()) {
    const dayStart = new Date(cursor);
    const dayEnd   = new Date(cursor);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const exception = relevantExceptions.find(
      ex => new Date(ex.start) < dayEnd && new Date(ex.end) > dayStart
    );

    if (exception) {
      const seats = exception.seats ?? 0;
      if (seats === 0) return 0;
      min = Math.min(min, seats);
    } else if (entries.length > 0) {
      const entry = entries.find(e => e.dayOfWeek === DAY_NAMES[cursor.getDay()]);
      const seats = entry?.seats ?? 0;
      if (seats === 0) return 0;
      min = Math.min(min, seats);
    } else {
      return null;
    }

    cursor.setDate(cursor.getDate() + 1);
    if (++daysChecked >= 7) break;
  }

  return min === Infinity ? null : min;
}

function toDatetimeLocal(date) {
  if (!date) return '';
  const d   = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildEvents(platformBookings, manualBookings, availabilityExceptions) {
  const platform = (platformBookings || []).map(b => ({
    id:    b.id,
    title: `${b.customerName} — ${b.listingTitle}`,
    start: b.start,
    end:   b.end,
    extendedProps: { bookingType: 'platform', ...b },
    backgroundColor: EVENT_COLORS.platform.bg,
    borderColor:     EVENT_COLORS.platform.border,
    textColor:       EVENT_COLORS.platform.text,
  }));

  const manual = (manualBookings || []).map(b => ({
    ...b,
    backgroundColor: EVENT_COLORS.manual.bg,
    borderColor:     EVENT_COLORS.manual.border,
    textColor:       EVENT_COLORS.manual.text,
  }));

  const linkedExceptionIds = new Set(
    (manualBookings || []).map(b => b.extendedProps?.availabilityExceptionId).filter(Boolean)
  );

  const exceptions = (availabilityExceptions || [])
    .filter(ex => !linkedExceptionIds.has(ex.id))
    .map(ex => ({
      id:    ex.id,
      title: `${ex.listingTitle || 'Availability'} — Exception`,
      start: ex.start,
      end:   ex.end,
      backgroundColor: EVENT_COLORS.unavailable.bg,
      borderColor:     EVENT_COLORS.unavailable.border,
      textColor:       EVENT_COLORS.unavailable.text,
      extendedProps: { bookingType: 'availability', ...ex },
    }));

  return [...platform, ...manual, ...exceptions];
}

// ─── Manual booking modal ─────────────────────────────────────────────────────

function ManualBookingModal({ slot, booking, listings, manualBookings, platformBookings, availabilityExceptions, onSave, onClose, saving }) {
  const isEdit = !!booking;
  const ep     = booking?.extendedProps || {};
  const [form, setForm] = useState({
    customerName:  ep.customerName  || '',
    customerPhone: ep.customerPhone || '',
    customerEmail: ep.customerEmail || '',
    listingId:     ep.listingId     || '',
    seats:         ep.seats         || 1,
    notes:         ep.notes         || '',
    startTime: isEdit ? toDatetimeLocal(booking.start) : (slot?.startStr ? toDatetimeLocal(slot.startStr) : ''),
    endTime:   isEdit ? toDatetimeLocal(booking.end)   : (slot?.endStr   ? toDatetimeLocal(slot.endStr)   : ''),
  });

  const selectedListing  = listings.find(l => l.id === form.listingId);
  const noAvailability   = !!selectedListing && selectedListing.seats === null;
  const hasSlot          = !!form.startTime && !!form.endTime;

  // Exclude exceptions that were created by manual bookings — they already encode reduced
  // remaining seats, so using them as totalSeats would double-count the manual booking.
  const linkedExceptionIds = new Set(
    (manualBookings || []).map(b => b.extendedProps?.availabilityExceptionId).filter(Boolean)
  );
  const unlinkedExceptions = (availabilityExceptions || []).filter(ex => !linkedExceptionIds.has(ex.id));

  const slotCapacity     = (!noAvailability && hasSlot)
    ? getSlotCapacity(selectedListing?.availabilityPlan, form.startTime, form.endTime, unlinkedExceptions, form.listingId)
    : null;
  const notAvailableOnDay = !noAvailability && hasSlot && slotCapacity === 0;
  const totalSeats        = slotCapacity ?? selectedListing?.seats ?? null;

  const alreadyBookedSeats = (() => {
    if (!form.listingId || !hasSlot || noAvailability || notAvailableOnDay) return 0;
    const newStart = new Date(form.startTime);
    const newEnd   = new Date(form.endTime);
    const overlaps = b => new Date(b.start) < newEnd && new Date(b.end) > newStart;
    const manualSeats   = (manualBookings || [])
      .filter(b => b.extendedProps?.listingId === form.listingId && b.id !== booking?.id && overlaps(b))
      .reduce((sum, b) => sum + (b.extendedProps?.seats || 1), 0);
    const platformSeats = (platformBookings || [])
      .filter(b => b.listingId === form.listingId && overlaps(b))
      .reduce((sum, b) => sum + (b.seats || 1), 0);
    return manualSeats + platformSeats;
  })();

  const availableSeats = (noAvailability || notAvailableOnDay || totalSeats === null)
    ? null
    : totalSeats - alreadyBookedSeats;
  const seatsExceeded  = availableSeats !== null && Number(form.seats) > availableSeats;
  const isValid        = form.customerName && form.listingId && hasSlot
                      && Number(form.seats) >= 1 && !seatsExceeded && !noAvailability && !notAvailableOnDay;

  const handleChange = e => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = () => {
    if (!isValid) return;
    onSave({ form, listing: selectedListing });
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>

        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>{isEdit ? 'Edit booking' : 'Add manual booking'}</h3>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.formGrid}>

          <label style={styles.label}>
            Customer name *
            <input style={styles.input} name="customerName" value={form.customerName} onChange={handleChange} />
          </label>

          <label style={styles.label}>
            Phone number
            <input style={styles.input} name="customerPhone" type="tel" value={form.customerPhone} onChange={handleChange} />
          </label>

          <label style={styles.label}>
            Customer email
            <input style={styles.input} name="customerEmail" type="email" value={form.customerEmail} onChange={handleChange} />
          </label>

          <label style={styles.label}>
            Listing / service *
            <select style={styles.input} name="listingId" value={form.listingId} onChange={handleChange}>
              <option value="">Select a listing…</option>
              {listings.map(l => (
                <option key={l.id} value={l.id}>
                  {l.title}{l.unitType ? ` (${l.unitType})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label style={styles.label}>
            Pets *
            <input style={styles.input} name="seats" type="number" min="1" max={totalSeats} value={form.seats} onChange={handleChange} />
          </label>

          {selectedListing && (
            noAvailability ? (
              <div style={{ ...styles.listingInfo, ...styles.listingInfoError, gridTemplateColumns: '1fr' }}>
                <span style={styles.listingInfoErrorValue}>No availability configured — bookings cannot be made for this listing</span>
              </div>
            ) : notAvailableOnDay ? (
              <div style={{ ...styles.listingInfo, ...styles.listingInfoError, gridTemplateColumns: '1fr' }}>
                <span style={styles.listingInfoErrorValue}>Listing not available on the selected day(s)</span>
              </div>
            ) : hasSlot && availableSeats !== null ? (
              <div style={{ ...styles.listingInfo, ...(seatsExceeded ? styles.listingInfoError : {}) }}>
                <span style={styles.listingInfoLabel}>Availability after booking</span>
                {seatsExceeded
                  ? <span style={styles.listingInfoErrorValue}>Exceeds capacity by {Number(form.seats) - availableSeats}</span>
                  : <span style={styles.listingInfoValue}>{availableSeats - Number(form.seats)} of {totalSeats}</span>
                }
              </div>
            ) : null
          )}

          <label style={styles.label}>
            Start *
            <input style={styles.input} name="startTime" type="datetime-local" value={form.startTime} onChange={handleChange} />
          </label>

          <label style={styles.label}>
            End *
            <input style={styles.input} name="endTime" type="datetime-local" value={form.endTime} onChange={handleChange} />
          </label>

          <label style={styles.label}>
            Notes
            <textarea style={{ ...styles.input, height: '72px', resize: 'vertical' }} name="notes" value={form.notes} onChange={handleChange} placeholder="Any notes about this booking…" />
          </label>

        </div>

        <div style={styles.modalFooter}>
          <button style={styles.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button
            style={{ ...styles.saveBtn, opacity: !isValid || saving ? 0.5 : 1 }}
            onClick={handleSubmit}
            disabled={!isValid || saving}
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save booking'}
          </button>
        </div>

        {saving && <p style={styles.savingNote}>Updating listing availability…</p>}

      </div>
    </div>
  );
}

// ─── Event popover ────────────────────────────────────────────────────────────

function EventPopover({ event, position, onClose, onDelete, onEdit }) {
  const props         = event.extendedProps || {};
  const isManual      = props.bookingType === 'manual';
  const isException   = props.bookingType === 'availability';

  return (
    <div style={{ ...styles.popover, top: position.y, left: position.x }} onClick={e => e.stopPropagation()}>
      <div style={styles.popoverHeader}>
        <span style={{ ...styles.badge, background: isManual ? EVENT_COLORS.manual.bg : EVENT_COLORS.platform.bg, color: '#fff' }}>
          {isManual ? 'Manual booking' : 'Platform booking'}
        </span>
        <button onClick={onClose} style={styles.closeBtn}>✕</button>
      </div>

      <p style={styles.popoverTitle}>{event.title}</p>

      <div style={styles.popoverDetail}>
        <span style={styles.popoverLabel}>Time</span>
        <span>{formatTime(event.start)} – {formatTime(event.end)}</span>
      </div>

      {props.listingTitle && (
        <div style={styles.popoverDetail}>
          <span style={styles.popoverLabel}>Listing</span>
          <span>{props.listingTitle}</span>
        </div>
      )}

      {props.seats != null && (
        <div style={styles.popoverDetail}>
          <span style={styles.popoverLabel}>{isException ? 'Total Availability' : 'Pets'}</span>
          <span>{props.seats}</span>
        </div>
      )}

      {props.customerPhone && (
        <div style={styles.popoverDetail}>
          <span style={styles.popoverLabel}>Phone</span>
          <span>{props.customerPhone}</span>
        </div>
      )}

      {props.customerEmail && (
        <div style={styles.popoverDetail}>
          <span style={styles.popoverLabel}>Email</span>
          <span>{props.customerEmail}</span>
        </div>
      )}

      {props.notes && (
        <div style={styles.popoverDetail}>
          <span style={styles.popoverLabel}>Notes</span>
          <span>{props.notes}</span>
        </div>
      )}

      {isManual && (
        <div style={styles.popoverActions}>
          <button style={styles.editBtn} onClick={() => onEdit(event)}>
            Edit booking
          </button>
          <button style={styles.deleteBtn} onClick={() => onDelete(event.id, props)}>
            Delete booking
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProviderCalendar({
  listings             = [],
  platformBookings     = [],
  availabilityExceptions = [],
  manualBookings       = [],
  loading              = false,
  saving               = false,
  error                = null,
  onSaveManual,
  onEditManual,
  onDeleteManual,
  onRefresh,
}) {
  const calendarRef                         = useRef(null);
  const [modalSlot, setModalSlot]           = useState(null);
  const [editingBooking, setEditingBooking] = useState(null);
  const [selectedEvent, setSelectedEvent]   = useState(null);
  const [popoverPos, setPopoverPos]         = useState({ x: 0, y: 0 });
  const [currentTitle, setCurrentTitle]     = useState('');
  const [viewRange, setViewRange]           = useState({ start: null, end: null });
  const [viewType, setViewType]             = useState('timeGridWeek');

  const events = buildEvents(platformBookings, manualBookings, availabilityExceptions);

  const inView = b => {
    if (!viewRange.start) return true;
    return new Date(b.start) < viewRange.end && new Date(b.end || b.start) > viewRange.start;
  };

  const stats = {
    platform: platformBookings.filter(inView).length,
    manual:   manualBookings.filter(inView).length,
    total:    [...platformBookings, ...manualBookings].filter(inView).length,
  };

  const handleDateSelect = info => { setSelectedEvent(null); setModalSlot(info); };

  const handleEventClick = info => {
    const rect          = info.el.getBoundingClientRect();
    const containerRect = info.el.closest('.fc')?.getBoundingClientRect() || rect;
    setPopoverPos({
      x: Math.min(rect.left - containerRect.left, containerRect.width - 280),
      y: rect.bottom - containerRect.top + 8,
    });
    setSelectedEvent(info.event);
  };

  const handleSave = async data => {
    await onSaveManual(data);
    setModalSlot(null);
  };

  const handleEdit = async data => {
    await onEditManual({ ...data, bookingId: editingBooking.id, extendedProps: editingBooking.extendedProps || {} });
    setEditingBooking(null);
  };

  const handleDelete = async (id, props) => {
    await onDeleteManual(id, props);
    setSelectedEvent(null);
  };

  const goToday    = () => calendarRef.current?.getApi().today();
  const goPrev     = () => calendarRef.current?.getApi().prev();
  const goNext     = () => calendarRef.current?.getApi().next();
  const switchView = v  => calendarRef.current?.getApi().changeView(v);

  return (
    <div style={styles.container} onClick={() => setSelectedEvent(null)}>

      <div style={styles.header}>
        <div>
          <h2 style={styles.heading}>Your calendar</h2>
          <p style={styles.subheading}>All your bookings in one place</p>
        </div>
      </div>

      <div style={styles.statsRow}>
        {[
          { label: 'Platform bookings',                                   value: stats.platform },
          { label: 'Manual bookings',                                     value: stats.manual   },
          { label: viewType === 'dayGridMonth' ? 'This month' : 'This week', value: stats.total },
        ].map(({ label, value }) => (
          <div key={label} style={styles.statCard}>
            <span style={styles.statLabel}>{label}</span>
            <span style={styles.statValue}>{value}</span>
          </div>
        ))}
      </div>

      <div style={styles.legendRow}>
        <div style={styles.legend}>
          {[
            { color: EVENT_COLORS.platform.bg,    label: 'Platform booking' },
            { color: EVENT_COLORS.manual.bg,      label: 'Manual booking'   },
            { color: EVENT_COLORS.unavailable.bg, label: 'Availability Exception', border: EVENT_COLORS.unavailable.border },
          ].map(({ color, label, border }) => (
            <div key={label} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: color, border: border ? `1px solid ${border}` : 'none' }} />
              <span style={styles.legendLabel}>{label}</span>
            </div>
          ))}
        </div>
        <div style={styles.legendActions}>
          <button style={styles.refreshBtn} onClick={onRefresh} disabled={loading}>
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
          <button style={styles.addBtn} onClick={() => setModalSlot({ startStr: '', endStr: '' })}>
            + Add manual booking
          </button>
        </div>
      </div>

      {error && <div style={styles.errorBanner}>{typeof error === 'string' ? error : 'Something went wrong. Please try again.'}</div>}

      <div style={styles.calendarWrapper} onClick={e => e.stopPropagation()}>
        {loading && (
          <div style={styles.loadingOverlay}>
            <span style={styles.loadingText}>Loading your bookings…</span>
          </div>
        )}

        <div style={styles.navBar}>
          <div style={styles.navLeft}>
            <button style={styles.navBtn} onClick={goPrev}>‹</button>
            <button style={styles.navBtn} onClick={goNext}>›</button>
            <button style={{ ...styles.navBtn, ...styles.todayBtn }} onClick={goToday}>Today</button>
            <span style={styles.navTitle}>{currentTitle}</span>
          </div>
          <div style={styles.viewSwitcher}>
            <button style={styles.viewBtn} onClick={() => switchView('timeGridWeek')}>Week</button>
            <button style={styles.viewBtn} onClick={() => switchView('dayGridMonth')}>Month</button>
          </div>
        </div>

        <FullCalendar
          ref={calendarRef}
          plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={false}
          events={events}
          selectable={true}
          selectMirror={true}
          select={handleDateSelect}
          eventClick={handleEventClick}
          datesSet={info => {
            setCurrentTitle(info.view.title);
            setViewRange({ start: info.start, end: info.end });
            setViewType(info.view.type);
          }}
          firstDay={1}
          locale="en-GB"
          height="auto"
          allDaySlot={false}
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
          nowIndicator={true}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: true }}
          slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: true }}
        />

        {selectedEvent && (
          <EventPopover
            event={selectedEvent}
            position={popoverPos}
            onClose={() => setSelectedEvent(null)}
            onDelete={handleDelete}
            onEdit={event => { setEditingBooking(event); setSelectedEvent(null); }}
          />
        )}
      </div>

      {(modalSlot || editingBooking) && (
        <ManualBookingModal
          slot={modalSlot}
          booking={editingBooking}
          listings={listings}
          manualBookings={manualBookings}
          platformBookings={platformBookings}
          availabilityExceptions={availabilityExceptions}
          onSave={editingBooking ? handleEdit : handleSave}
          onClose={() => { setModalSlot(null); setEditingBooking(null); }}
          saving={saving}
        />
      )}

    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  container:        { fontFamily: 'system-ui, -apple-system, sans-serif', padding: '24px', maxWidth: '1100px', margin: '0 auto', color: '#2C2C2A', position: 'relative' },
  header:           { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
  heading:          { fontSize: '22px', fontWeight: '500', margin: '0 0 4px' },
  subheading:       { fontSize: '14px', color: '#888780', margin: 0 },
  legendActions:    { display: 'flex', gap: '8px', alignItems: 'center' },
  refreshBtn:       { background: 'transparent', border: '0.5px solid #B4B2A9', borderRadius: '8px', padding: '10px 16px', fontSize: '14px', fontWeight: '500', cursor: 'pointer', color: '#444441' },
  addBtn:           { background: 'var(--marketplaceColor)', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  statsRow:         { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' },
  statCard:         { background: '#F1EFE8', borderRadius: '8px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '4px' },
  statLabel:        { fontSize: '12px', color: '#888780', textTransform: 'uppercase', letterSpacing: '0.05em' },
  statValue:        { fontSize: '24px', fontWeight: '500', color: '#2C2C2A' },
  legendRow:        { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' },
  legend:           { display: 'flex', gap: '20px', flexWrap: 'wrap' },
  legendItem:       { display: 'flex', alignItems: 'center', gap: '6px' },
  legendDot:        { width: '10px', height: '10px', borderRadius: '50%', display: 'inline-block' },
  legendLabel:      { fontSize: '13px', color: '#5F5E5A' },
  errorBanner:      { background: '#FCEBEB', border: '0.5px solid #F09595', borderRadius: '8px', padding: '12px 16px', fontSize: '13px', color: '#A32D2D', marginBottom: '16px' },
  calendarWrapper:  { position: 'relative', border: '0.5px solid #D3D1C7', borderRadius: '12px', overflow: 'hidden', background: '#fff' },
  loadingOverlay:   { position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  loadingText:      { fontSize: '14px', color: '#888780' },
  navBar:           { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '0.5px solid #D3D1C7', background: '#F1EFE8' },
  navLeft:          { display: 'flex', alignItems: 'center', gap: '8px' },
  navBtn:           { background: 'transparent', border: '0.5px solid #B4B2A9', borderRadius: '6px', padding: '4px 10px', fontSize: '15px', cursor: 'pointer', color: '#444441' },
  todayBtn:         { fontSize: '13px', padding: '4px 12px' },
  navTitle:         { fontSize: '15px', fontWeight: '500', color: '#2C2C2A', marginLeft: '8px' },
  viewSwitcher:     { display: 'flex', gap: '4px' },
  viewBtn:          { background: 'transparent', border: '0.5px solid #B4B2A9', borderRadius: '6px', padding: '4px 12px', fontSize: '13px', cursor: 'pointer', color: '#444441' },
  modalOverlay:     { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal:            { background: '#fff', borderRadius: '12px', width: '480px', maxWidth: '95vw', padding: '24px', boxSizing: 'border-box', maxHeight: '90vh', overflowY: 'auto' },
  modalHeader:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  modalTitle:       { fontSize: '17px', fontWeight: '500', margin: 0 },
  closeBtn:         { background: 'transparent', border: 'none', fontSize: '16px', cursor: 'pointer', color: '#888780', padding: '4px' },
  formGrid:         { display: 'flex', flexDirection: 'column', gap: '14px' },
  label:            { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#5F5E5A', fontWeight: '500' },

  input:            { border: '0.5px solid #B4B2A9', borderRadius: '6px', padding: '8px 10px', fontSize: '14px', color: '#2C2C2A', background: '#fff', outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
  listingInfo:           { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px', background: '#F1EFE8', borderRadius: '6px', padding: '10px 12px', fontSize: '13px', alignItems: 'center' },
  listingInfoError:      { background: '#FCEBEB', border: '0.5px solid #F09595' },
  listingInfoLabel:      { color: '#888780' },
  listingInfoValue:      { fontWeight: '500', color: '#2C2C2A' },
  listingInfoErrorValue: { fontWeight: '500', color: '#A32D2D' },
  fieldError:            { fontSize: '12px', color: '#A32D2D', marginTop: '2px' },
  modalFooter:      { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' },
  cancelBtn:        { background: 'transparent', border: '0.5px solid #B4B2A9', borderRadius: '6px', padding: '8px 16px', fontSize: '14px', cursor: 'pointer', color: '#444441' },
  saveBtn:          { background: 'var(--marketplaceColor)', border: 'none', borderRadius: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: '500', color: '#fff', cursor: 'pointer' },
  savingNote:       { fontSize: '12px', color: '#888780', textAlign: 'center', marginTop: '12px' },
  popover:          { position: 'absolute', background: '#fff', border: '0.5px solid #D3D1C7', borderRadius: '10px', padding: '16px', width: '260px', zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.10)' },
  popoverHeader:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
  badge:            { fontSize: '11px', fontWeight: '500', padding: '3px 8px', borderRadius: '20px', letterSpacing: '0.02em' },
  popoverTitle:     { fontSize: '14px', fontWeight: '500', margin: '0 0 10px', color: '#2C2C2A' },
  popoverDetail:    { display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#444441', marginBottom: '6px', gap: '8px' },
  popoverLabel:     { color: '#888780', flexShrink: 0 },
  popoverActions:   { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' },
  editBtn:          { background: 'transparent', border: '0.5px solid #B4B2A9', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', color: '#444441', cursor: 'pointer', width: '100%' },
  deleteBtn:        { background: 'transparent', border: '0.5px solid #F09595', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', color: '#A32D2D', cursor: 'pointer', width: '100%' },
};
