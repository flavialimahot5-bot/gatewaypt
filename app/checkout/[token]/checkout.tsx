"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { watchCheckout } from "../../../lib/checkout-polling";
import PixReceipt from "../../comprar/pix-receipt";
export default function Checkout({ token }: { token: string }) {
  const [tx, setTx] = useState<any>(null),
    [error, setError] = useState(""),
    [qr, setQr] = useState("");
  useEffect(() => watchCheckout(token, setTx, setError), [token]);
  const pixCode = tx?.pix?.copy_paste;
  useEffect(() => {
    if (!pixCode) return;
    let stopped = false;
    void QRCode.toDataURL(pixCode, { width: 280, margin: 2, errorCorrectionLevel: "M" }).then(image => { if (!stopped) setQr(image); }).catch(() => { if (!stopped) setQr(""); });
    return () => { stopped = true; };
  }, [pixCode]);
  return <PixReceipt tx={tx} qr={qr} error={error} />;
}
