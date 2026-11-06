// Shaped like Getty's search page data (search.gallery in the
// data-component="Search" script), trimmed to the fields the probe reads.
// Recorded from a real "portishead" editorial search, 2026-11-06; the preview
// signatures are made up.

function asset(over) {
  return Object.assign({
    assetType: "image",
    family: "editorial",
    orientation: "Horizontal",
  }, over);
}

const PORTISHEAD_ASSETS = [
  asset({
    id: "480270124",
    title: "Montreux Jazz Festival 2015",
    shortTitle: "Montreux Jazz Festival 2015",
    caption: "MONTREUX, SWITZERLAND - JULY 10:  Portishead perform on stage at Auditorium Stravinski on July 10, 2015 in Montreux, Switzerland.  (Photo by Edu Hawkins/Redferns)",
    artist: "Edu Hawkins",
    collectionName: "Redferns",
    dateCreated: "10. Juli 2015",
    dateSubmitted: "2015-07-10",
    people: "Beth Gibbons",
    thumbUrl: "https://media.gettyimages.com/id/480270124/de/foto/montreux-switzerland-portishead-perform.jpg?s=612x612&w=0&k=20&c=SIGNATURE1",
  }),
  asset({
    id: "992089350",
    title: "Beth Gibbons Of Portishead",
    shortTitle: "Beth Gibbons Of Portishead",
    caption: "Beth Gibbons of Portishead performs at the Vic Theater in Chicago, Illinois, April 25, 1995. (Photo by Paul Natkin/Getty Images)",
    artist: "Paul Natkin",
    collectionName: "Archive Photos",
    dateCreated: "25. April 1995",
    dateSubmitted: "2018-07-03",
    people: "Beth Gibbons, Portishead - Band",
    orientation: "Vertical",
    thumbUrl: "https://media.gettyimages.com/id/992089350/de/foto/beth-gibbons.jpg?s=612x612&w=0&k=20&c=SIGNATURE2",
  }),
  // Another band from the same scene: Getty's search is broad.
  asset({
    id: "1234567890",
    title: "Massive Attack Live",
    shortTitle: "Massive Attack Live",
    caption: "Robert Del Naja of Massive Attack performs in Bristol.",
    artist: "Jim Dyson",
    collectionName: "Moment",
    dateCreated: "3. Mai 2019",
    people: "",
    thumbUrl: "https://media.gettyimages.com/id/1234567890/de/foto/massive.jpg?s=612x612&w=0&k=20&c=SIGNATURE3",
  }),
  // Not an image, a bad id, a preview from the wrong host, a duplicate.
  asset({ id: "555555555", assetType: "film", title: "Portishead clip", caption: "Portishead live" }),
  asset({ id: "not-an-id", title: "Portishead", caption: "Portishead" }),
  asset({
    id: "119675320",
    title: "I'll Be Your Mirror - Day 1",
    shortTitle: "I'll Be Your Mirror - Day 1",
    caption: "LONDON, UNITED KINGDOM - JULY 23: Beth Gibbons of the band 'Portishead' performs on day one of 'I'll Be Your Mirror' at Alexandra Palace.",
    artist: "Nick Pickles",
    collectionName: "WireImage",
    dateCreated: "23. Juli 2011",
    people: "Beth Gibbons",
    thumbUrl: "https://evil.example.com/id/119675320.jpg",
  }),
  asset({ id: "480270124", title: "Duplicate", caption: "Portishead again" }),
  // Named, but the town: a real result for "Portishead" (seen in the app).
  asset({
    id: "905500670",
    title: "Portishead Dock And Branch Railway Line",
    shortTitle: "Portishead Dock And Branch Railway Line",
    caption: "Portishead Dock and branch railway line, Portishead, North Somerset, 1972. Artist Aerofilms. (Photo by English Heritage/Heritage Images/Getty Images)",
    artist: "Heritage Images",
    collectionName: "Hulton Archive",
    dateCreated: "January 01, 1972",
    thumbUrl: "https://media.gettyimages.com/id/905500670/photo/portishead-dock.jpg?s=612x612&w=0&k=20&c=SIGNATURE4",
  }),
];

function result(assets, extra) {
  return Object.assign({
    host: "www.gettyimages.at",
    total: 1076,
    page: 1,
    lastPage: 18,
    assets,
  }, extra);
}

module.exports = { PORTISHEAD_ASSETS, result, asset };
