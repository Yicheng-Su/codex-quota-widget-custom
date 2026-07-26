using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class PortableLauncher
{
    private const string FooterMagic = "CQWZIP-PAYLOAD01";
    private const int FooterSize = 8 + 16;
    private const string AppExecutable = "ChatGPT Quota.exe";
    private const string VersionLabel = "1.4.1-custom";

    [STAThread]
    private static int Main()
    {
        try
        {
            string selfPath = Process.GetCurrentProcess().MainModule.FileName;
            PayloadInfo payload = ReadPayloadInfo(selfPath);
            string payloadHash = ComputePayloadHash(selfPath, payload);
            string shortHash = payloadHash.Substring(0, 16).ToLowerInvariant();
            string baseRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ChatGPTQuotaCustom"
            );
            string targetRoot = Path.Combine(baseRoot, VersionLabel + "-" + shortHash);
            string mutexName = "Local\\ChatGPTQuotaCustom-" + shortHash;

            using (var mutex = new Mutex(false, mutexName))
            {
                bool lockTaken = false;
                try
                {
                    try
                    {
                        lockTaken = mutex.WaitOne(TimeSpan.FromSeconds(45));
                    }
                    catch (AbandonedMutexException)
                    {
                        lockTaken = true;
                    }
                    if (!lockTaken)
                        throw new InvalidOperationException("另一个挂件启动程序仍在准备运行文件，请稍后重试。");

                    EnsureExtracted(selfPath, payload, payloadHash, baseRoot, targetRoot);
                    string executable = Path.Combine(targetRoot, AppExecutable);
                    if (!File.Exists(executable))
                        throw new FileNotFoundException("运行文件不完整。", executable);

                    var startInfo = new ProcessStartInfo
                    {
                        FileName = executable,
                        WorkingDirectory = targetRoot,
                        UseShellExecute = false
                    };
                    Process.Start(startInfo);
                }
                finally
                {
                    if (lockTaken) mutex.ReleaseMutex();
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "自定义额度挂件无法启动：\r\n\r\n" + error.Message,
                "ChatGPT Quota Custom",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return 1;
        }
    }

    private static PayloadInfo ReadPayloadInfo(string selfPath)
    {
        byte[] magic = Encoding.ASCII.GetBytes(FooterMagic);
        if (magic.Length != 16) throw new InvalidOperationException("启动器尾标长度不正确。");

        using (var stream = new FileStream(selfPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (var reader = new BinaryReader(stream, Encoding.UTF8, true))
        {
            if (stream.Length <= FooterSize) throw new InvalidDataException("启动器没有附带运行包。");
            stream.Seek(-FooterSize, SeekOrigin.End);
            long payloadLength = reader.ReadInt64();
            byte[] actualMagic = reader.ReadBytes(magic.Length);
            if (!FixedTimeEquals(actualMagic, magic)) throw new InvalidDataException("启动器尾标不匹配。");
            long payloadOffset = stream.Length - FooterSize - payloadLength;
            if (payloadLength <= 0 || payloadOffset < 0)
                throw new InvalidDataException("启动器运行包长度不正确。");
            return new PayloadInfo(payloadOffset, payloadLength);
        }
    }

    private static string ComputePayloadHash(string selfPath, PayloadInfo payload)
    {
        using (var stream = new FileStream(selfPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (var hash = SHA256.Create())
        {
            stream.Position = payload.Offset;
            byte[] buffer = new byte[1024 * 1024];
            long remaining = payload.Length;
            while (remaining > 0)
            {
                int requested = (int)Math.Min(buffer.Length, remaining);
                int read = stream.Read(buffer, 0, requested);
                if (read <= 0) throw new EndOfStreamException("运行包提前结束。");
                hash.TransformBlock(buffer, 0, read, null, 0);
                remaining -= read;
            }
            hash.TransformFinalBlock(new byte[0], 0, 0);
            return ToHex(hash.Hash);
        }
    }

    private static void EnsureExtracted(
        string selfPath,
        PayloadInfo payload,
        string payloadHash,
        string baseRoot,
        string targetRoot
    )
    {
        string marker = Path.Combine(targetRoot, ".payload.sha256");
        if (IsValidExistingTarget(targetRoot, marker, payloadHash)) return;

        Directory.CreateDirectory(baseRoot);
        if (Directory.Exists(targetRoot)) DeleteDirectorySafely(baseRoot, targetRoot);
        string partialRoot = targetRoot + ".partial-" + Process.GetCurrentProcess().Id + "-" + Guid.NewGuid().ToString("N");
        AssertWithinBase(baseRoot, partialRoot);
        Directory.CreateDirectory(partialRoot);

        try
        {
            string zipPath = Path.Combine(partialRoot, ".payload.zip");
            CopyPayload(selfPath, payload, zipPath);
            ExtractZipSafely(zipPath, partialRoot);
            File.Delete(zipPath);
            if (!File.Exists(Path.Combine(partialRoot, AppExecutable)))
                throw new InvalidDataException("运行包中缺少主程序。");
            File.WriteAllText(Path.Combine(partialRoot, ".payload.sha256"), payloadHash, new UTF8Encoding(false));

            try
            {
                Directory.Move(partialRoot, targetRoot);
            }
            catch (IOException)
            {
                if (!IsValidExistingTarget(targetRoot, marker, payloadHash)) throw;
                DeleteDirectorySafely(baseRoot, partialRoot);
            }
        }
        catch
        {
            DeleteDirectorySafely(baseRoot, partialRoot);
            throw;
        }
    }

    private static bool IsValidExistingTarget(string targetRoot, string marker, string payloadHash)
    {
        try
        {
            return Directory.Exists(targetRoot)
                && File.Exists(Path.Combine(targetRoot, AppExecutable))
                && File.Exists(marker)
                && String.Equals(File.ReadAllText(marker).Trim(), payloadHash, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static void CopyPayload(string selfPath, PayloadInfo payload, string zipPath)
    {
        using (var input = new FileStream(selfPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (var output = new FileStream(zipPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            input.Position = payload.Offset;
            byte[] buffer = new byte[1024 * 1024];
            long remaining = payload.Length;
            while (remaining > 0)
            {
                int requested = (int)Math.Min(buffer.Length, remaining);
                int read = input.Read(buffer, 0, requested);
                if (read <= 0) throw new EndOfStreamException("运行包提前结束。");
                output.Write(buffer, 0, read);
                remaining -= read;
            }
            output.Flush(true);
        }
    }

    private static void ExtractZipSafely(string zipPath, string destinationRoot)
    {
        string root = Path.GetFullPath(destinationRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        using (var stream = new FileStream(zipPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Read, false))
        {
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                if (String.IsNullOrWhiteSpace(relative)) continue;
                string target = Path.GetFullPath(Path.Combine(destinationRoot, relative));
                if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("运行包包含越界路径：" + entry.FullName);

                if (String.IsNullOrEmpty(entry.Name))
                {
                    Directory.CreateDirectory(target);
                    continue;
                }

                string parent = Path.GetDirectoryName(target);
                if (!String.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                using (Stream input = entry.Open())
                using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    input.CopyTo(output);
                    output.Flush(true);
                }
            }
        }
    }

    private static void DeleteDirectorySafely(string baseRoot, string target)
    {
        try
        {
            AssertWithinBase(baseRoot, target);
            if (Directory.Exists(target)) Directory.Delete(target, true);
        }
        catch
        {
            // Cleanup is best effort; never broaden deletion after a failure.
        }
    }

    private static void AssertWithinBase(string baseRoot, string target)
    {
        string root = Path.GetFullPath(baseRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string fullTarget = Path.GetFullPath(target);
        if (!fullTarget.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("拒绝访问自定义挂件缓存目录之外的路径。");
    }

    private static bool FixedTimeEquals(byte[] left, byte[] right)
    {
        if (left == null || right == null || left.Length != right.Length) return false;
        int difference = 0;
        for (int index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
        return difference == 0;
    }

    private static string ToHex(byte[] bytes)
    {
        var builder = new StringBuilder(bytes.Length * 2);
        foreach (byte value in bytes) builder.Append(value.ToString("x2"));
        return builder.ToString();
    }

    private sealed class PayloadInfo
    {
        internal readonly long Offset;
        internal readonly long Length;

        internal PayloadInfo(long offset, long length)
        {
            Offset = offset;
            Length = length;
        }
    }
}
