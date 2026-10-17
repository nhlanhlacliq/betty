import { ServiceBook, starterBook } from '../core/Reminders';

const KEY = 'betty.service.v1';

/**
 * Betty's odometer and the service reminders, on this phone (in the backup like every betty.* entry). The first load
 * starts the usual set, counted from that day; he edits them in Garage.
 */
export const ServiceStore = {
  load(now = Date.now()): ServiceBook {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (v && typeof v.odoKm === 'number' && Array.isArray(v.items)) return v as ServiceBook;
    } catch { /* fall through */ }
    const book = starterBook(0, now);
    ServiceStore.save(book);
    return book;
  },
  save(book: ServiceBook) {
    try { localStorage.setItem(KEY, JSON.stringify(book)); } catch { /* full or blocked */ }
    try { window.dispatchEvent(new window.Event('betty-service')); } catch { /* no window (tests) */ }
  },
  /** Adds km ridden (a delta, so an odometer he set mid-ride is kept). */
  addKm(km: number) {
    if (!(km > 0)) return;
    const b = ServiceStore.load();
    ServiceStore.save({ ...b, odoKm: Math.round((b.odoKm + km) * 10) / 10 });
  },
};
