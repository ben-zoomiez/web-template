import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { storableError } from '../../util/errors';
import {
  createAvailabilityException as apiCreateException,
  deleteAvailabilityException as apiDeleteException,
} from '../../util/api';
import { types as sdkTypes } from '../../util/sdkLoader';

const { UUID } = sdkTypes;

// ================ Async Thunks ================ //

////////////////////////////
// Fetch Listings          //
////////////////////////////

const fetchListingsPayloadCreator = async (_, { extra: sdk, rejectWithValue }) => {
  try {
    const response = await sdk.ownListings.query({ perPage: 100 });
    const listings = (response.data.data || []).map(l => ({
      id:       l.id.uuid,
      title:    l.attributes.title,
      unitType: l.attributes.publicData?.unitType || null,
      seats:    l.attributes.publicData?.seats
             || l.attributes.availabilityPlan?.seats
             || 1,
    }));
    return { listings };
  } catch (e) {
    return rejectWithValue(storableError(e));
  }
};

export const fetchListingsThunk = createAsyncThunk(
  'app/CalendarPage/fetchListings',
  fetchListingsPayloadCreator
);

////////////////////////////
// Fetch Platform Bookings //
////////////////////////////

const fetchPlatformBookingsPayloadCreator = async (_, { extra: sdk, rejectWithValue }) => {
  try {
    const response = await sdk.transactions.query({
      only: 'sale',
      lastTransitions: [
        'transition/accept',
        'transition/operator-accept',
        'transition/complete',
      ],
      include: ['booking', 'customer', 'listing'],
      perPage: 100,
    });

    const txs      = response.data.data || [];
    const included = response.data.included || [];

    const bookings = txs.map(tx => {
      const bookingRef  = tx.relationships?.booking?.data;
      const booking     = included.find(i => i.type === 'booking' && i.id?.uuid === bookingRef?.id?.uuid);
      const customerRef = tx.relationships?.customer?.data;
      const customer    = included.find(i => i.type === 'user'    && i.id?.uuid === customerRef?.id?.uuid);
      const listingRef  = tx.relationships?.listing?.data;
      const listing     = included.find(i => i.type === 'listing' && i.id?.uuid === listingRef?.id?.uuid);

      return {
        id:           `platform-${tx.id?.uuid || tx.id}`,
        customerName: customer?.attributes?.profile?.displayName || 'Customer',
        listingTitle: listing?.attributes?.title || 'Booking',
        listingId:    listingRef?.id?.uuid || '',
        start:        booking?.attributes?.start || tx.attributes?.createdAt,
        end:          booking?.attributes?.end   || tx.attributes?.createdAt,
        seats:        booking?.attributes?.seats || 1,
      };
    });

    return { bookings };
  } catch (e) {
    return rejectWithValue(storableError(e));
  }
};

export const fetchPlatformBookingsThunk = createAsyncThunk(
  'app/CalendarPage/fetchPlatformBookings',
  fetchPlatformBookingsPayloadCreator
);

////////////////////////////
// Fetch Availability      //
// Exceptions              //
////////////////////////////

// Queries exceptions for each listing over a rolling window (30 days ago → 90 days ahead).
// Calls the Marketplace API directly since this is a provider read operation.
const fetchAvailabilityExceptionsPayloadCreator = async ({ listingIds, listings }, { extra: sdk, rejectWithValue }) => {
  try {
    const start = new Date(Date.now() - 30  * 24 * 60 * 60 * 1000);
    const end   = new Date(Date.now() + 90  * 24 * 60 * 60 * 1000);

    const results = await Promise.all(
      listingIds.map(id =>
        sdk.availabilityExceptions
          .query({ listingId: new UUID(id), start, end, perPage: 100 })
          .then(res => ({ listingId: id, res }))
      )
    );

    const exceptions = results.flatMap(({ listingId, res }) => {
      const listingTitle = (listings || []).find(l => l.id === listingId)?.title || '';
      return (res.data.data || []).map(ex => ({
        id:           ex.id.uuid,
        listingId,
        listingTitle,
        start:        ex.attributes.start,
        end:          ex.attributes.end,
        seats:        ex.attributes.seats,
      }));
    });

    return { exceptions };
  } catch (e) {
    return rejectWithValue(storableError(e));
  }
};

export const fetchAvailabilityExceptionsThunk = createAsyncThunk(
  'app/CalendarPage/fetchAvailabilityExceptions',
  fetchAvailabilityExceptionsPayloadCreator
);

////////////////////////////
// Create Availability     //
// Exception               //
////////////////////////////

// Calls the server endpoint which uses the user-scoped SDK session.
// seats = max(0, listing.seats - booked) so partial-seat listings stay partially available.
const createAvailabilityExceptionPayloadCreator = async (params, { rejectWithValue }) => {
  try {
    const response = await apiCreateException(params);
    const exceptionId = response?.data?.id?.uuid;
    return {
      exceptionId,
      exception: {
        id:           exceptionId,
        listingId:    params.listingId,
        listingTitle: params.listingTitle || '',
        start:        params.start,
        end:          params.end,
        seats:        params.seats,
      },
    };
  } catch (e) {
    return rejectWithValue(storableError(e));
  }
};

export const createAvailabilityExceptionThunk = createAsyncThunk(
  'app/CalendarPage/createAvailabilityException',
  createAvailabilityExceptionPayloadCreator
);

////////////////////////////
// Delete Availability     //
// Exception               //
////////////////////////////

const deleteAvailabilityExceptionPayloadCreator = async ({ id }, { rejectWithValue }) => {
  try {
    await apiDeleteException({ id });
    return { id };
  } catch (e) {
    return rejectWithValue(storableError(e));
  }
};

export const deleteAvailabilityExceptionThunk = createAsyncThunk(
  'app/CalendarPage/deleteAvailabilityException',
  deleteAvailabilityExceptionPayloadCreator
);

// ================ Slice ================ //

const calendarPageSlice = createSlice({
  name: 'CalendarPage',
  initialState: {
    listings:              [],
    platformBookings:      [],
    availabilityExceptions: [],
    fetchListingsError:    null,
    fetchBookingsError:    null,
    fetchExceptionsError:  null,
    saveInProgress:        false,
    saveError:             null,
  },
  reducers: {
    clearErrors(state) {
      state.fetchListingsError   = null;
      state.fetchBookingsError   = null;
      state.fetchExceptionsError = null;
      state.saveError            = null;
    },
    setSaveInProgress(state, action) {
      state.saveInProgress = action.payload;
    },
    setSaveError(state, action) {
      state.saveError = action.payload;
    },
  },
  extraReducers: builder => {
    builder
      .addCase(fetchListingsThunk.fulfilled, (state, action) => {
        state.listings           = action.payload.listings;
        state.fetchListingsError = null;
      })
      .addCase(fetchListingsThunk.rejected, (state, action) => {
        state.fetchListingsError = action.payload;
      })
      .addCase(fetchPlatformBookingsThunk.fulfilled, (state, action) => {
        state.platformBookings   = action.payload.bookings;
        state.fetchBookingsError = null;
      })
      .addCase(fetchPlatformBookingsThunk.rejected, (state, action) => {
        state.fetchBookingsError = action.payload;
      })
      .addCase(fetchAvailabilityExceptionsThunk.fulfilled, (state, action) => {
        state.availabilityExceptions = action.payload.exceptions;
        state.fetchExceptionsError   = null;
      })
      .addCase(fetchAvailabilityExceptionsThunk.rejected, (state, action) => {
        state.fetchExceptionsError = action.payload;
      })
      .addCase(createAvailabilityExceptionThunk.fulfilled, (state, action) => {
        if (action.payload.exception?.id) {
          state.availabilityExceptions = [...state.availabilityExceptions, action.payload.exception];
        }
      })
      .addCase(deleteAvailabilityExceptionThunk.fulfilled, (state, action) => {
        state.availabilityExceptions = state.availabilityExceptions.filter(
          ex => ex.id !== action.payload.id
        );
      });
  },
});

export const { clearErrors, setSaveInProgress, setSaveError } = calendarPageSlice.actions;

export default calendarPageSlice.reducer;
