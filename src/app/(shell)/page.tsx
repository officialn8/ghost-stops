/**
 * The map with nothing selected: the shell layout is the whole page. The heading names the page
 * for screen readers; on a station page the station's name is the heading instead.
 */
export default function MapPage() {
  return <h1 className="sr-only">Ghost Stops: Chicago L stations ranked by ghost score</h1>;
}
