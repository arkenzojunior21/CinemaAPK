import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  groupShowtimesByCinema,
  mapSeatAvailability,
  type ShowtimeGroupRow,
} from '../../src/modules/showtimes/showtimes.service.js';

function row(cinemaId: string, showtimeId: string, minutesOffset: number, price: number): ShowtimeGroupRow {
  return {
    showtime_id: showtimeId,
    starts_at: new Date(Date.UTC(2026, 9, 12, 10 + minutesOffset)),
    format: '2D',
    language: 'English',
    subtitle: 'Indonesian',
    base_price: price,
    studio_id: 'studio-1',
    studio_name: 'Studio 1',
    screen_types: ['regular'],
    cinema_id: cinemaId,
    chain: 'CGV',
    cinema_name: cinemaId === 'c1' ? 'CGV Grand Indonesia' : 'XXI Senayan City',
    city: 'Jakarta',
  };
}

describe('mapSeatAvailability', () => {
  const me = 'user-1';
  const other = 'user-2';

  it('null reservation = available', () => {
    assert.equal(mapSeatAvailability(null, null, me), 'available');
  });

  it('released = available', () => {
    assert.equal(mapSeatAvailability('released', other, me), 'available');
  });

  it('confirmed = sold meski milik sendiri', () => {
    assert.equal(mapSeatAvailability('confirmed', me, me), 'sold');
    assert.equal(mapSeatAvailability('confirmed', other, me), 'sold');
  });

  it('locked milik sendiri = mine, milik orang lain = locked', () => {
    assert.equal(mapSeatAvailability('locked', me, me), 'mine');
    assert.equal(mapSeatAvailability('locked', other, me), 'locked');
  });

  it('locked saat tidak login = locked', () => {
    assert.equal(mapSeatAvailability('locked', other, null), 'locked');
  });
});

describe('groupShowtimesByCinema', () => {
  it('mengelompokkan per bioskop dengan urutan tetap', () => {
    const rows = [
      row('c1', 'st-1', 0, 40000),
      row('c2', 'st-2', 1, 50000),
      row('c1', 'st-3', 2, 40000),
    ];
    const groups = groupShowtimesByCinema(rows);

    assert.equal(groups.length, 2);
    assert.equal(groups[0].cinema.id, 'c1');
    assert.equal(groups[0].cinema.name, 'CGV Grand Indonesia');
    assert.equal(groups[0].showtimes.length, 2);
    assert.equal(groups[0].showtimes[0].id, 'st-1');
    assert.equal(groups[0].showtimes[1].id, 'st-3');
    assert.equal(groups[1].cinema.id, 'c2');
    assert.equal(groups[1].showtimes[0].base_price, 50000);
  });

  it('input kosong menghasilkan grup kosong', () => {
    assert.deepEqual(groupShowtimesByCinema([]), []);
  });
});
