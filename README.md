# Book Collection

A personal book app: the books I own, what I'm reading and have read (and how: print, ebook,
audiobook, library or borrowed), reviews, notes, quotes, a wishlist, shelves and tags, plus new
books by authors I follow.

**Live app:** https://mchughde.github.io/book-collection/

## Using it

- **Mac:** open the link in Safari, then File → Add to Dock. Or double-click `Book Collection.command`.
- **iPhone / iPad:** open the link in Safari, then Share → Add to Home Screen.
- **Adding books:** search by title, author or ISBN, scan the barcode on the back (iPhone/iPad camera), or type the details in.
- **New books:** follow an author from any book's page. "New books" lists their books from this year and last.

## Where the books are kept

This repo holds only the app's code. It's public, because free GitHub Pages hosting needs that.
**No book data is ever in this repo.**

The books themselves are saved on each device and synced through a separate **private** repo,
`book-collection-data` (one file, `library.json`). Each device needs a GitHub access key pasted in
once (Settings & sync in the app explains how). GitHub keeps every version of that file, so the
private repo is also the backup. "Save a backup file" in Settings makes a file copy as well.

Book details and covers come from [Open Library](https://openlibrary.org), which is free and needs no account.

## Updating the app

Edit the files, check them locally, then commit and push. GitHub Pages updates within a minute or two.
The global pre-commit hook bumps the version in `sw.js` automatically, so devices pick up the change.
