-- Apple Photos Exporter
-- Prompts you to pick an album (or All Photos) and an export folder,
-- then exports original files with metadata sidecars.

on run
  tell application "Photos"
    activate
    set albumNames to {"All Photos"}
    set albumsList to albums
    repeat with a in albumsList
      set end of albumNames to (name of a)
    end repeat
  end tell

  set chosenAlbum to choose from list albumNames with prompt "Select an Apple Photos album to export:" default items {"All Photos"} without empty selection allowed
  if chosenAlbum is false then return
  set chosenName to item 1 of chosenAlbum

  set exportFolder to choose folder with prompt "Choose export destination folder"

  tell application "Photos"
    if chosenName is equal to "All Photos" then
      set mediaItems to (every media item)
    else
      set mediaItems to (get media items of (first album whose name is chosenName))
    end if

    set exportCount to count of mediaItems
    display dialog "Exporting " & exportCount & " item(s) to " & POSIX path of exportFolder buttons {"OK"} default button 1 giving up after 2

    -- Export originals with XMP sidecars so EXIF/creation dates persist
    export mediaItems to (exportFolder as alias) with using originals and with using IPTC as separate files without naming
  end tell

  display dialog "Export complete." buttons {"OK"} default button 1
end run
