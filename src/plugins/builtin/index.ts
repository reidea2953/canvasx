/**
 * Loading a plugin is importing its file — registration is a side effect of the
 * module.
 *
 * This list is the ONLY thing that changes when an element type is added. No
 * core file learns about it: not the renderer, not persistence, not search, not
 * the menu.
 */
import './sticky';
import './callout';
import './code/codeblock';
import './flowchart';
import './divider';
import './table/table';
