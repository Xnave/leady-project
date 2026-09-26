/** Skeleton for /leads: header, pipeline strip and eight rows, in the list's own classes. */
export default function LeadsLoading() {
  return (
    <div className="crm-page" aria-busy="true">
      <div className="page-header">
        <span className="crm-skel" style={{ inlineSize: "140px", blockSize: "28px" }} />
      </div>
      <div className="crm-pipe" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="crm-pipe-cell skel">
            <span className="crm-skel w60" />
            <span className="crm-skel w40" style={{ blockSize: "22px" }} />
          </div>
        ))}
      </div>
      <div className="crm-list" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="crm-row skel">
            <span className="crm-col-cb" />
            <span className="crm-who">
              <span className="crm-skel av" />
              <span className="crm-who-t" style={{ flex: 1 }}>
                <span className="crm-skel w80" />
              </span>
            </span>
            <span className="crm-col-stage">
              <span className="crm-skel chip" />
            </span>
            <span className="crm-stand">
              <span className="crm-skel w80" />
            </span>
            <span className="crm-col-fu">
              <span className="crm-skel w60" />
            </span>
            <span className="crm-last">
              <span className="crm-skel w60" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
