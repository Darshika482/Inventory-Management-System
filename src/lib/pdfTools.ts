/** jsPDF and its table plugin, downloaded only when a PDF is actually made. */
export async function loadPdfTools() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return { jsPDF, autoTable };
}
