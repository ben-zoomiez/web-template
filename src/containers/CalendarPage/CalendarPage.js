import React, { useCallback, useEffect, useState } from 'react';
import { compose } from 'redux';
import { connect, useDispatch } from 'react-redux';

import { useIntl } from '../../util/reactIntl';
import { isScrollingDisabled } from '../../ducks/ui.duck';

import {
  Page,
  UserNav,
  LayoutSingleColumn,
} from '../../components';

import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';

import {
  fetchListingsThunk,
  fetchPlatformBookingsThunk,
  fetchAvailabilityExceptionsThunk,
  createAvailabilityExceptionThunk,
  deleteAvailabilityExceptionThunk,
  setSaveInProgress,
  setSaveError,
} from './CalendarPage.duck';

import ProviderCalendar from '../../components/ProviderCalendar/ProviderCalendar';
import css from './CalendarPage.module.css';

const MANUAL_BOOKINGS_KEY = 'provider_manual_bookings';

export const CalendarPageComponent = props => {
  const {
    scrollingDisabled,
    listings,
    platformBookings,
    availabilityExceptions,
    saveInProgress,
    saveError,
    fetchListingsError,
    fetchBookingsError,
  } = props;

  const dispatch = useDispatch();
  const intl     = useIntl();
  const title    = intl.formatMessage({ id: 'CalendarPage.title' });

  const [manualBookings, setManualBookings] = useState([]);
  const [loading, setLoading]               = useState(true);

  // Load persisted manual bookings
  useEffect(() => {
    try {
      const stored = localStorage.getItem(MANUAL_BOOKINGS_KEY);
      if (stored) setManualBookings(JSON.parse(stored));
    } catch (e) {
      console.warn('Could not load manual bookings:', e);
    }
  }, []);

  const loadCalendarData = useCallback(async () => {
    setLoading(true);
    try {
      const [{ listings: loadedListings }] = await Promise.all([
        dispatch(fetchListingsThunk()).unwrap(),
        dispatch(fetchPlatformBookingsThunk()).unwrap(),
      ]);
      if (loadedListings.length > 0) {
        await dispatch(
          fetchAvailabilityExceptionsThunk({ listingIds: loadedListings.map(l => l.id), listings: loadedListings })
        ).unwrap();
      }
    } catch (e) {
      console.error('Failed to load calendar data:', e);
    }
    setLoading(false);
  }, [dispatch]);

  useEffect(() => { loadCalendarData(); }, [loadCalendarData]);

  // Save a manual booking and create a matching availability exception
  const handleSaveManual = async ({ form, listing }) => {
    dispatch(setSaveInProgress(true));
    dispatch(setSaveError(null));

    // Partially block the slot: leave remaining seats available for platform bookings
    const remainingSeats = Math.max(0, (listing.seats || 1) - Number(form.seats));

    let availabilityExceptionId = null;
    try {
      const result = await dispatch(
        createAvailabilityExceptionThunk({
          listingId:    listing.id,
          listingTitle: listing.title,
          start:        form.startTime,
          end:          form.endTime,
          seats:        remainingSeats,
        })
      ).unwrap();
      availabilityExceptionId = result.exceptionId;
    } catch (e) {
      dispatch(setSaveError('Booking saved, but availability could not be blocked. Check your connection and try again.'));
    }

    const bookingId  = `manual-${Date.now()}`;
    const newBooking = {
      id:    bookingId,
      type:  'manual',
      title: `${form.customerName} — ${listing.title}`,
      start: form.startTime,
      end:   form.endTime,
      extendedProps: {
        bookingType:            'manual',
        customerName:           form.customerName,
        customerPhone:          form.customerPhone,
        customerEmail:          form.customerEmail,
        listingTitle:           listing.title,
        listingId:              listing.id,
        seats:                  Number(form.seats),
        notes:                  form.notes,
        availabilityExceptionId,
      },
    };

    const updated = [...manualBookings, newBooking];
    setManualBookings(updated);
    try { localStorage.setItem(MANUAL_BOOKINGS_KEY, JSON.stringify(updated)); }
    catch (e) { console.warn('Could not persist manual bookings:', e); }

    dispatch(setSaveInProgress(false));
  };

  // Edit a manual booking: swap the availability exception and update localStorage
  const handleEditManual = async ({ form, listing, bookingId, extendedProps }) => {
    dispatch(setSaveInProgress(true));
    dispatch(setSaveError(null));

    const remainingSeats = Math.max(0, (listing.seats || 1) - Number(form.seats));

    if (extendedProps.availabilityExceptionId) {
      try {
        await dispatch(deleteAvailabilityExceptionThunk({ id: extendedProps.availabilityExceptionId })).unwrap();
      } catch (e) {
        console.warn('Could not delete old availability exception:', e);
      }
    }

    let availabilityExceptionId = null;
    try {
      const result = await dispatch(
        createAvailabilityExceptionThunk({
          listingId:    listing.id,
          listingTitle: listing.title,
          start:        form.startTime,
          end:          form.endTime,
          seats:        remainingSeats,
        })
      ).unwrap();
      availabilityExceptionId = result.exceptionId;
    } catch (e) {
      dispatch(setSaveError('Booking updated, but availability could not be re-blocked.'));
    }

    const updatedBooking = {
      id:    bookingId,
      type:  'manual',
      title: `${form.customerName} — ${listing.title}`,
      start: form.startTime,
      end:   form.endTime,
      extendedProps: {
        bookingType:            'manual',
        customerName:           form.customerName,
        customerPhone:          form.customerPhone,
        customerEmail:          form.customerEmail,
        listingTitle:           listing.title,
        listingId:              listing.id,
        seats:                  Number(form.seats),
        notes:                  form.notes,
        availabilityExceptionId,
      },
    };

    const updated = manualBookings.map(b => b.id === bookingId ? updatedBooking : b);
    setManualBookings(updated);
    try { localStorage.setItem(MANUAL_BOOKINGS_KEY, JSON.stringify(updated)); }
    catch (e) { console.warn('Could not persist manual bookings:', e); }

    dispatch(setSaveInProgress(false));
  };

  // Delete a manual booking and remove the matching availability exception
  const handleDeleteManual = async (id, extendedProps) => {
    const { availabilityExceptionId } = extendedProps || {};
    if (availabilityExceptionId) {
      try {
        await dispatch(deleteAvailabilityExceptionThunk({ id: availabilityExceptionId })).unwrap();
      } catch (e) {
        console.warn('Could not delete availability exception:', e);
      }
    }
    const updated = manualBookings.filter(b => b.id !== id);
    setManualBookings(updated);
    localStorage.setItem(MANUAL_BOOKINGS_KEY, JSON.stringify(updated));
  };

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn
        topbar={<TopbarContainer currentPage="CalendarPage" />}
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          <UserNav currentPage="CalendarPage" showManageListingsLink />
          <div className={css.content}>
            <ProviderCalendar
              listings={listings}
              platformBookings={platformBookings}
              availabilityExceptions={availabilityExceptions}
              manualBookings={manualBookings}
              loading={loading}
              saving={saveInProgress}
              error={saveError || fetchListingsError || fetchBookingsError}
              onSaveManual={handleSaveManual}
              onEditManual={handleEditManual}
              onDeleteManual={handleDeleteManual}
              onRefresh={loadCalendarData}
            />
          </div>
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const page = state.CalendarPage || {};
  return {
    scrollingDisabled:      isScrollingDisabled(state),
    listings:               page.listings               || [],
    platformBookings:       page.platformBookings       || [],
    availabilityExceptions: page.availabilityExceptions || [],
    saveInProgress:         page.saveInProgress         || false,
    saveError:              page.saveError              || null,
    fetchListingsError:     page.fetchListingsError     || null,
    fetchBookingsError:     page.fetchBookingsError     || null,
  };
};

const CalendarPage = compose(connect(mapStateToProps))(CalendarPageComponent);

export default CalendarPage;
