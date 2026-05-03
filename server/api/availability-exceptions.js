const sharetribeSdk = require('sharetribe-flex-sdk');
const { getSdk, handleError, serialize } = require('../api-util/sdk');

const { UUID } = sharetribeSdk.types;

// POST /api/availability-exceptions
// Body: { listingId, start, end, seats }
// Creates an availability exception that blocks (or partially blocks) a time slot.
// seats=0 fully blocks; seats=N leaves N seats still bookable.
const createAvailabilityException = (req, res) => {
  const { listingId, start, end, seats } = req.body;

  if (!listingId || !start || !end) {
    return res.status(400).json({ error: 'listingId, start, and end are required' }).end();
  }

  const sdk = getSdk(req, res);

  sdk.availabilityExceptions
    .create({
      listingId: new UUID(listingId),
      seats: typeof seats === 'number' ? seats : 0,
      start: new Date(start),
      end: new Date(end),
    })
    .then(response => {
      res
        .status(200)
        .set('Content-Type', 'application/transit+json')
        .send(serialize(response.data))
        .end();
    })
    .catch(e => handleError(res, e));
};

// POST /api/delete-availability-exception
// Body: { id }  — the UUID of the availability exception to remove
const deleteAvailabilityException = (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'id is required' }).end();
  }

  const sdk = getSdk(req, res);

  sdk.availabilityExceptions
    .delete({ id: new UUID(id) })
    .then(() => {
      res.status(200).json({ deleted: id }).end();
    })
    .catch(e => handleError(res, e));
};

module.exports = { createAvailabilityException, deleteAvailabilityException };
